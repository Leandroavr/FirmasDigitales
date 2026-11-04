import pyhanko.sign.signers.pdf_signer as ps
ps._ensure_iso32002_ext = lambda x: None
ps._ensure_iso32001_ext = lambda x: None
import logging
logger = logging.getLogger("corporate_signer")
import asyncio
import base64
import hmac
import os
import re
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import unicodedata
from zoneinfo import ZoneInfo

from asn1crypto import cms, pem, tsp, x509
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from pyhanko.pdf_utils import layout
from pyhanko.pdf_utils.images import PdfImage
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils.text import TextBoxStyle
from pyhanko.sign.fields import FieldMDPAction, FieldMDPSpec, MDPPerm, SigFieldSpec
from pyhanko.sign.signers import (
    ExternalSigner,
    PdfSignatureMetadata,
    PdfSigner,
    SimpleSigner,
)
from pyhanko.sign.signers.pdf_signer import PdfTBSDocument, PreparedByteRangeDigest
from pyhanko.sign.timestamps import HTTPTimeStamper
from pyhanko.stamp import TextStamp, TextStampStyle
from pyhanko.sign.validation import async_validate_cms_signature
from pyhanko_certvalidator import ValidationContext

TOKEN = os.environ.get("CORPORATE_SIGNER_TOKEN", "")
TRUST_ROOTS_PATH = os.environ.get("CORPORATE_TRUST_ROOTS", "")
SESSION_TTL_SECONDS = int(os.environ.get("CORPORATE_SIGNER_SESSION_TTL", "900"))
SIGNING_TIME_TOLERANCE_SECONDS = int(os.environ.get("CORPORATE_SIGNING_TIME_TOLERANCE_SECONDS", "86400"))
RESERVED_CMS_BYTES = 32768
LOGO_PATH = os.environ.get("CORPORATE_STAMP_LOGO", "/app/brascuba_logo.jpg")
SIGNATURES_DIR = os.environ.get("CORPORATE_SIGNATURES_DIR", "/app/signatures")
CERTIFICATES_DIR = os.environ.get("CORPORATE_CERTIFICATES_DIR", "/app/certificates")
TSA_URL = os.environ.get("CORPORATE_TSA_URL", "https://rfc3161.ai.moda")



def check_has_previous_signatures(pdf_bytes: bytes) -> bool:
    try:
        reader = PdfFileReader(BytesIO(pdf_bytes))
        return bool(reader.embedded_signatures)
    except Exception:
        return False

SAFE_IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z0-9.@_\-\s\u00C0-\u017F]+$")

def sanitize_identifier(value: str | None) -> str:
    if not value:
        return ""
    val_str = str(value)
    if "\0" in val_str or ".." in val_str or "/" in val_str or "\\" in val_str:
        raise HTTPException(
            status_code=400,
            detail="Identificador no válido: contiene secuencias o caracteres de ruta prohibidos ('..', '/', '\\' o nulos).",
        )
    s = val_str.strip()
    if not SAFE_IDENTIFIER_PATTERN.match(s):
        raise HTTPException(
            status_code=400,
            detail="Identificador no válido: solo se permiten letras, números, '.', '@', '-', '_' y espacios.",
        )
    return s


def normalize_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def resolve_user_p12(signer_name: str, email: str) -> bytes | None:
    if not os.path.isdir(CERTIFICATES_DIR):
        return None

    try:
        files = [f for f in Path(CERTIFICATES_DIR).iterdir() if f.is_file()]
    except Exception:
        return None

    if not files:
        return None

    clean_signer = sanitize_identifier(signer_name)
    clean_email = sanitize_identifier(email).strip().lower()

    file_map: dict[str, Path] = {}
    for f in files:
        if f.suffix.lower() in (".p12", ".pfx"):
            norm_stem = normalize_name(f.stem)
            file_map[norm_stem] = f
            file_map[f.stem.lower()] = f

    candidates: list[str] = []
    if clean_email:
        candidates.append(clean_email)
        user_part = clean_email.split("@")[0]
        candidates.append(user_part)
        candidates.append(user_part.replace(".", "_"))
        candidates.append(user_part.replace(".", "-"))
        candidates.append(user_part.replace(".", " "))

    if clean_signer:
        candidates.append(clean_signer)
        norm_name = normalize_name(clean_signer)
        candidates.append(norm_name)
        candidates.append(norm_name.replace(" ", "_"))
        candidates.append(norm_name.replace(" ", "-"))
        candidates.append(norm_name.replace(" ", "."))
        tokens = norm_name.split()
        if len(tokens) >= 2:
            candidates.append(f"{tokens[0]}_{tokens[1]}")
            candidates.append(f"{tokens[0]}.{tokens[1]}")
            candidates.append(f"{tokens[0]}_{tokens[-1]}")
            candidates.append(f"{tokens[0]}.{tokens[-1]}")

    for c in candidates:
        norm_c = normalize_name(c)
        if norm_c in file_map:
            try:
                return file_map[norm_c].read_bytes()
            except Exception:
                pass
        if c.lower() in file_map:
            try:
                return file_map[c.lower()].read_bytes()
            except Exception:
                pass

    return None


def resolve_user_image(signer_name: str, email: str) -> str:
    clean_signer = sanitize_identifier(signer_name)
    clean_email = sanitize_identifier(email).strip().lower()

    if os.path.isdir(SIGNATURES_DIR):
        try:
            files = [f for f in Path(SIGNATURES_DIR).iterdir() if f.is_file()]
        except Exception:
            files = []

        if files:
            file_map: dict[str, str] = {}
            for f in files:
                if f.suffix.lower() in (".png", ".jpg", ".jpeg"):
                    norm_stem = normalize_name(f.stem)
                    file_map[norm_stem] = str(f)
                    file_map[f.stem.lower()] = str(f)

            candidates: list[str] = []
            if clean_email:
                candidates.append(clean_email)
                user_part = clean_email.split("@")[0]
                candidates.append(user_part)
                candidates.append(user_part.replace(".", "_"))
                candidates.append(user_part.replace(".", "-"))
                candidates.append(user_part.replace(".", " "))

            if clean_signer:
                candidates.append(clean_signer)
                norm_name = normalize_name(clean_signer)
                candidates.append(norm_name)
                candidates.append(norm_name.replace(" ", "_"))
                candidates.append(norm_name.replace(" ", "-"))
                candidates.append(norm_name.replace(" ", "."))
                tokens = norm_name.split()
                if len(tokens) >= 2:
                    candidates.append(f"{tokens[0]}_{tokens[1]}")
                    candidates.append(f"{tokens[0]}.{tokens[1]}")
                    candidates.append(f"{tokens[0]}_{tokens[-1]}")
                    candidates.append(f"{tokens[0]}.{tokens[-1]}")

            for c in candidates:
                norm_c = normalize_name(c)
                if norm_c in file_map:
                    return file_map[norm_c]
                if c.lower() in file_map:
                    return file_map[c.lower()]

    # Fallback: si el usuario no tiene rúbrica escaneada en signatures/, se utiliza el logo corporativo general
    return LOGO_PATH


@dataclass(frozen=True)
class CorporateLogoTextStampStyle(TextStampStyle):
    image_path: str = LOGO_PATH
    innsep: int = 8
    cuba_time_str: str | None = None

    def create_stamp(self, writer, box, text_params: dict):
        params = dict(text_params or {})
        if self.cuba_time_str:
            params["ts"] = self.cuba_time_str
        elif "cuba_time" in params:
            params["ts"] = params["cuba_time"]
        return CorporateLogoTextStamp(writer, style=self, text_params=params, box=box)


class CorporateLogoTextStamp(TextStamp):
    def __init__(self, writer, style: CorporateLogoTextStampStyle, text_params=None, box=None):
        super().__init__(writer, style, text_params=text_params, box=box)
        self.image_path = style.image_path

    def _inner_layout_natural_size(self):
        text_commands, (text_width, text_height) = super()._inner_layout_natural_size()

        if not self.image_path or not os.path.exists(self.image_path):
            return text_commands, (text_width, text_height)

        try:
            img = Image.open(self.image_path)
            aspect = img.width / img.height
            img_h = text_height
            img_w = round(img_h * aspect)

            pdf_img = PdfImage(
                img,
                writer=self.writer,
                box=layout.BoxConstraints(img_w, img_h),
            )
            img_cmd = pdf_img.render()
            self.import_resources(pdf_img.resources)

            innsep = self.style.innsep
            total_width = img_w + innsep + text_width
            total_height = text_height

            inner_box = layout.BoxConstraints(total_width, total_height)

            # 1. Imagen (Rúbrica del usuario o Logo Brascuba de fallback) a la izquierda
            img_layout = layout.SimpleBoxLayoutRule(
                x_align=layout.AxisAlignment.ALIGN_MIN,
                y_align=layout.AxisAlignment.ALIGN_MID,
                margins=layout.Margins(left=0, right=0, top=0, bottom=0),
                inner_content_scaling=layout.InnerScaling.NO_SCALING,
            )
            img_pos = img_layout.fit(inner_box, img_w, text_height)

            # 2. Texto legal a la derecha
            text_layout = layout.SimpleBoxLayoutRule(
                x_align=layout.AxisAlignment.ALIGN_MIN,
                y_align=layout.AxisAlignment.ALIGN_MID,
                margins=layout.Margins(left=img_w + innsep, right=0, top=0, bottom=0),
                inner_content_scaling=layout.InnerScaling.NO_SCALING,
            )
            text_pos = text_layout.fit(inner_box, text_width, text_height)

            commands = [
                b"q", img_pos.as_cm(), img_cmd, b"Q",
                b"q", text_pos.as_cm(), *text_commands, b"Q",
            ]
            return commands, (total_width, total_height)
        except Exception:
            return text_commands, (text_width, text_height)


def build_stamp_style(
    image_path: str = LOGO_PATH,
    cuba_time_str: str | None = None,
    reason: str | None = None,
    location: str | None = None,
) -> TextStampStyle:
    lines = [
        "Firmado digitalmente por:",
        "%(signer)s",
        "%(email)s",
        "%(ts)s",
    ]
    if reason and reason.strip():
        lines.append(f"Motivo: {reason.strip()}")
    if location and location.strip():
        lines.append(f"Ubicación: {location.strip()}")

    stamp_text = "\n".join(lines)
    has_extra = bool((reason and reason.strip()) or (location and location.strip()))
    return CorporateLogoTextStampStyle(
        image_path=image_path,
        cuba_time_str=cuba_time_str,
        stamp_text=stamp_text,
        timestamp_format="%d/%m/%Y %H:%M:%S",
        border_width=1,
        border_color=(0.15, 0.35, 0.6),
        text_box_style=TextBoxStyle(
            font_size=9 if has_extra else 10,
            leading=11 if has_extra else 13,
        ),
        inner_content_layout=layout.SimpleBoxLayoutRule(
            x_align=layout.AxisAlignment.ALIGN_MID,
            y_align=layout.AxisAlignment.ALIGN_MID,
            margins=layout.Margins(left=4, right=4, top=3, bottom=3),
            inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT,
        ),
    )


async def get_trusted_signing_time(timestamper: HTTPTimeStamper | None) -> tuple[datetime, str]:
    if timestamper is not None:
        try:
            token = await asyncio.wait_for(
                timestamper.async_timestamp(b"\x00" * 32, "sha256"),
                timeout=5.0,
            )
            signed_data = token["content"]
            encap_content = signed_data["encap_content_info"]
            tst_info = tsp.TSTInfo.load(encap_content["content"].parsed.dump())
            gen_time = tst_info["gen_time"].native
            if gen_time.tzinfo is None:
                gen_time = gen_time.replace(tzinfo=timezone.utc)
            cuba_tz = ZoneInfo("America/Havana")
            cuba_time = gen_time.astimezone(cuba_tz)
            return gen_time, cuba_time.strftime("%d/%m/%Y %H:%M:%S")
        except Exception:
            pass

    try:
        cuba_tz = ZoneInfo("America/Havana")
        now_cuba = datetime.now(cuba_tz)
        return datetime.now(timezone.utc), now_cuba.strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        now_utc = datetime.now(timezone.utc)
        return now_utc, now_utc.strftime("%d/%m/%Y %H:%M:%S")


app = FastAPI()


@dataclass
class PreparedSignature:
    document_id: str
    signer_id: str
    expected_email: str
    expected_name: str
    prepared_pdf: bytes
    digest: bytes
    region_start: int
    region_end: int
    created_at: float


prepared_signatures: dict[str, PreparedSignature] = {}


class PrepareRequest(BaseModel):
    pdf: str = Field(min_length=1)
    certificate: str = Field(min_length=1, max_length=50000)
    document_id: str = Field(min_length=1, max_length=128)
    signer_id: str = Field(min_length=1, max_length=128)
    email: str = Field(min_length=3, max_length=320)
    page: int = Field(ge=0)
    box: list[float] = Field(min_length=4, max_length=4)
    reason: str | None = Field(default=None, max_length=256)
    location: str | None = Field(default=None, max_length=256)
    lock_document: bool = Field(default=False)


class CompleteRequest(BaseModel):
    signature_id: str = Field(min_length=32, max_length=64)
    document_id: str = Field(min_length=1, max_length=128)
    signer_id: str = Field(min_length=1, max_length=128)
    cms_signature: str = Field(min_length=1, max_length=200000)


class DirectSignRequest(BaseModel):
    pdf: str = Field(min_length=1)
    p12: str = Field(default="")
    password: str = Field(default="")
    document_id: str = Field(min_length=1, max_length=128)
    signer_id: str = Field(min_length=1, max_length=128)
    email: str = Field(min_length=1, max_length=320)
    page: int = Field(ge=0)
    box: list[float] = Field(min_length=4, max_length=4)
    reason: str | None = Field(default=None, max_length=256)
    location: str | None = Field(default=None, max_length=256)
    lock_document: bool = Field(default=False)


def require_service_token(authorization: str | None) -> None:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="Corporate signer is not configured")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not hmac.compare_digest(supplied, TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def load_trust_roots() -> list[x509.Certificate]:
    if not TRUST_ROOTS_PATH:
        raise HTTPException(status_code=503, detail="Institutional trust roots are not configured")
    roots_file = Path(TRUST_ROOTS_PATH)
    if not roots_file.is_file():
        raise HTTPException(status_code=503, detail="Institutional trust roots are unavailable")
    raw = roots_file.read_bytes()
    roots: list[x509.Certificate] = []
    if pem.detect(raw):
        for _, _, der_bytes in pem.unarmor(raw, multiple=True):
            roots.append(x509.Certificate.load(der_bytes))
    else:
        roots.append(x509.Certificate.load(raw))
    if not roots:
        raise HTTPException(status_code=503, detail="No institutional trust roots were loaded")
    return roots


REVOCATION_MODE = os.environ.get("CORPORATE_REVOCATION_MODE", "soft-fail")
ALLOW_FETCHING = os.environ.get("CORPORATE_ALLOW_FETCHING", "false").lower() in ("1", "true", "yes")


def validation_context() -> ValidationContext:
    return ValidationContext(
        trust_roots=load_trust_roots(),
        allow_fetching=ALLOW_FETCHING,
        revocation_mode=REVOCATION_MODE,
    )


def certificate_emails(certificate: x509.Certificate) -> set[str]:
    found = set()
    subject_email = certificate.subject.native.get("email_address")
    if subject_email:
        found.add(subject_email.casefold())
    for extension in certificate["tbs_certificate"]["extensions"]:
        if extension["extn_id"].dotted != "2.5.29.17":
            continue
        for name in extension["extn_value"].parsed:
            if name.name == "rfc822_name":
                found.add(name.chosen.native.casefold())
    return found


def signer_certificate(signed_data: cms.SignedData) -> x509.Certificate:
    if len(signed_data["signer_infos"]) != 1:
        raise HTTPException(status_code=400, detail="Exactly one CMS signer is required")
    signer_info = signed_data["signer_infos"][0]
    sid = signer_info["sid"]

    candidates = [
        cert_choice.chosen
        for cert_choice in signed_data["certificates"]
        if cert_choice.name == "certificate"
    ]
    if not candidates:
        raise HTTPException(status_code=400, detail="CMS has no certificates")

    # If only one certificate is attached to the CMS, it is the signer certificate
    if len(candidates) == 1:
        return candidates[0]

    for certificate in candidates:
        if sid.name == "issuer_and_serial_number":
            issuer_serial = sid.chosen
            # Primary check: unique serial number within issuer
            if certificate.serial_number == issuer_serial["serial_number"].native:
                return certificate
        elif sid.name == "subject_key_identifier":
            try:
                extension = certificate.extensions.get_extension_for_oid("2.5.29.14")
                if extension.native == sid.chosen.native:
                    return certificate
            except (KeyError, ValueError):
                continue

    # Fallback to first candidate if available
    return candidates[0]


def signed_time(signed_data: cms.SignedData) -> datetime:
    signer_info = signed_data["signer_infos"][0]
    if signer_info["signed_attrs"].native is None:
        raise HTTPException(status_code=400, detail="CMS signed attributes are required")
    for attribute in signer_info["signed_attrs"]:
        if attribute["type"].native == "signing_time":
            value = attribute["values"][0].native
            return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    raise HTTPException(status_code=400, detail="CMS signing time is required")


def remove_expired_sessions() -> None:
    expires_before = time.time() - SESSION_TTL_SECONDS
    for signature_id, prepared in list(prepared_signatures.items()):
        if prepared.created_at < expires_before:
            prepared_signatures.pop(signature_id, None)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/prepare")
async def prepare(
    request: PrepareRequest,
    authorization: str | None = Header(default=None),
):
    require_service_token(authorization)
    remove_expired_sessions()
    try:
        pdf_bytes = base64.b64decode(request.pdf, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid PDF encoding") from error
    if not pdf_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF")

    x1, y1, x2, y2 = request.box
    if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=400, detail="Invalid signature field bounds")

    try:
        certificate_bytes = base64.b64decode(request.certificate, validate=True)
        certificate = x509.Certificate.load(certificate_bytes)
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail="Invalid signing certificate") from error
    signer_name = certificate.subject.native.get("common_name", "")
    if not signer_name:
        raise HTTPException(status_code=403, detail="Certificate has no common name")
    cert_emails = certificate_emails(certificate)
    display_email = next(iter(cert_emails)) if cert_emails else request.email

    writer = IncrementalPdfFileWriter(BytesIO(pdf_bytes))
    try:
        writer.find_page_for_modification(request.page)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Signature page is outside the document") from error
    signature_field_name = f"CorporateSignature_{secrets.token_hex(12)}"
    tsa_url = TSA_URL.strip() if TSA_URL else ""
    timestamper = HTTPTimeStamper(tsa_url) if tsa_url else None
    _, trusted_time_str = await get_trusted_signing_time(timestamper)
    user_image = resolve_user_image(signer_name, display_email)
    if not user_image:
        raise HTTPException(
            status_code=404,
            detail="Su certificado digital o su imagen de firma no están configurados. Contacte al administrador.",
        )
    has_prev_sigs = check_has_previous_signatures(pdf_bytes)
    appearance_params = {
        "signer": signer_name,
        "email": display_email,
        "ts": trusted_time_str,
    }
    if request.reason and request.reason.strip():
        appearance_params["reason"] = request.reason.strip()
    if request.location and request.location.strip():
        appearance_params["location"] = request.location.strip()

    is_certify = bool(request.lock_document and not has_prev_sigs)
    lock_all_fields = bool(request.lock_document)

    signer = PdfSigner(
        PdfSignatureMetadata(
            field_name=signature_field_name,
            reason=request.reason.strip() if request.reason and request.reason.strip() else None,
            location=request.location.strip() if request.location and request.location.strip() else None,
            name=signer_name,
            md_algorithm="sha256",
            certify=is_certify,
            docmdp_permissions=MDPPerm.NO_CHANGES if is_certify else MDPPerm.FILL_FORMS,
        ),
        signer=ExternalSigner(certificate, None),
        stamp_style=build_stamp_style(user_image, cuba_time_str=trusted_time_str, reason=request.reason, location=request.location),
        new_field_spec=SigFieldSpec(
            sig_field_name=signature_field_name,
            on_page=request.page,
            box=(x1, y1, x2, y2),
            field_mdp_spec=FieldMDPSpec(action=FieldMDPAction.ALL) if lock_all_fields else None,
            doc_mdp_update_value=MDPPerm.NO_CHANGES if lock_all_fields else None,
        ),


    )
    prepared_digest, _, output = await signer.async_digest_doc_for_signing(
        writer,
        bytes_reserved=RESERVED_CMS_BYTES,
        appearance_text_params=appearance_params,
    )
    signature_id = secrets.token_urlsafe(32)
    prepared_signatures[signature_id] = PreparedSignature(
        document_id=request.document_id,
        signer_id=request.signer_id,
        expected_email=display_email.casefold(),
        expected_name=signer_name,
        prepared_pdf=output.getvalue(),
        digest=prepared_digest.document_digest,
        region_start=prepared_digest.reserved_region_start,
        region_end=prepared_digest.reserved_region_end,
        created_at=time.time(),
    )
    return {
        "signatureId": signature_id,
        "digest": base64.b64encode(prepared_digest.document_digest).decode("ascii"),
        "digestAlgorithm": "SHA-256",
        "preparedPdf": base64.b64encode(
            prepared_signatures[signature_id].prepared_pdf
        ).decode("ascii"),
        "byteRange": [
            0,
            prepared_digest.reserved_region_start,
            prepared_digest.reserved_region_end,
            len(prepared_signatures[signature_id].prepared_pdf)
            - prepared_digest.reserved_region_end,
        ],
    }


@app.post("/complete")
async def complete(
    request: CompleteRequest,
    authorization: str | None = Header(default=None),
):
    require_service_token(authorization)
    remove_expired_sessions()
    prepared = prepared_signatures.get(request.signature_id)
    if prepared is None:
        raise HTTPException(status_code=410, detail="Signing session expired or was already used")
    if (
        prepared.document_id != request.document_id
        or prepared.signer_id != request.signer_id
    ):
        raise HTTPException(status_code=403, detail="Signing session does not match request")
    try:
        cms_bytes = base64.b64decode(request.cms_signature, validate=True)
        content_info = cms.ContentInfo.load(cms_bytes)
        if content_info["content_type"].native != "signed_data":
            raise HTTPException(status_code=400, detail="CMS SignedData is required")
        signed_data = content_info["content"]
        certificate = signer_certificate(signed_data)
        cert_name = certificate.subject.native.get("common_name", "")
        if cert_name.casefold() != prepared.expected_name.casefold():
            raise HTTPException(status_code=403, detail="Certificate name does not match appearance")
        if SIGNING_TIME_TOLERANCE_SECONDS > 0:
            signing_date = signed_time(signed_data)
            now = datetime.now(timezone.utc)
            if abs((now - signing_date).total_seconds()) > SIGNING_TIME_TOLERANCE_SECONDS:
                raise HTTPException(status_code=403, detail="CMS signing time is outside the allowed window")
        cert_not_before = certificate["tbs_certificate"]["validity"]["not_before"].native
        cert_not_after = certificate["tbs_certificate"]["validity"]["not_after"].native
        if cert_not_before.tzinfo is None:
            cert_not_before = cert_not_before.replace(tzinfo=timezone.utc)
        if cert_not_after.tzinfo is None:
            cert_not_after = cert_not_after.replace(tzinfo=timezone.utc)
        if not cert_not_before <= now <= cert_not_after:
            raise HTTPException(status_code=403, detail="Certificate is not currently valid")

        status = await async_validate_cms_signature(
            signed_data,
            raw_digest=prepared.digest,
            validation_context=validation_context(),
        )
        if not status.trusted:
            raise HTTPException(
                status_code=403,
                detail="CMS signature, certificate chain, or revocation check failed",
            )

        output = BytesIO(prepared.prepared_pdf)
        prepared_digest = PreparedByteRangeDigest(
            prepared.digest,
            prepared.region_start,
            prepared.region_end,
        )
        await PdfTBSDocument.async_finish_signing(
            output,
            prepared_digest,
            cms_bytes,
        )
        result = output.getvalue()
        prepared_signatures.pop(request.signature_id, None)
        return {"pdf": base64.b64encode(result).decode("ascii")}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail="Could not validate or embed CMS signature") from error


@app.post("/sign_direct")
async def sign_direct(
    request: DirectSignRequest,
    authorization: str | None = Header(default=None),
):
    require_service_token(authorization)
    try:
        pdf_bytes = base64.b64decode(request.pdf, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Codificación del PDF no válida") from error
    if not pdf_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="El archivo PDF no es válido")

    p12_bytes = None
    if request.p12 and request.p12.strip():
        try:
            p12_bytes = base64.b64decode(request.p12, validate=True)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Codificación del archivo .p12 no válida") from error
    else:
        p12_bytes = resolve_user_p12("", request.email)
        if not p12_bytes:
            raise HTTPException(
                status_code=404,
                detail="Su certificado digital o su imagen de firma no están configurados. Contacte al administrador.",
            )

    try:
        roots = load_trust_roots()
    except Exception:
        roots = []

    passwords_to_try = [request.password]
    if request.password and request.password.strip() != request.password:
        passwords_to_try.append(request.password.strip())

    signer = None
    last_err = None
    for pw in passwords_to_try:
        try:
            pw_bytes = pw.encode("utf-8") if pw else None
            signer = SimpleSigner.load_pkcs12_data(
                p12_bytes,
                other_certs=roots,
                passphrase=pw_bytes,
            )
            break
        except Exception as err:
            last_err = err

    if signer is None:
        raise HTTPException(
            status_code=400,
            detail="Contraseña del certificado digital (.p12) incorrecta o archivo no válido.",
        )

    cert = signer.signing_cert
    signer_name = cert.subject.native.get("common_name", "")
    if not signer_name:
        raise HTTPException(
            status_code=403, detail="El certificado no contiene Nombre Común (CN)"
        )

    cert_emails = certificate_emails(cert)
    display_email = next(iter(cert_emails)) if cert_emails else request.email

    x1, y1, x2, y2 = request.box
    if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=400, detail="Las dimensiones del campo de firma no son válidas")

    writer = IncrementalPdfFileWriter(BytesIO(pdf_bytes))
    try:
        writer.find_page_for_modification(request.page)
    except Exception as error:
        raise HTTPException(
            status_code=400, detail="La página indicada para la firma está fuera del documento"
        ) from error

    signature_field_name = f"CorporateSignature_{secrets.token_hex(12)}"
    tsa_url = TSA_URL.strip() if TSA_URL else ""
    timestamper = HTTPTimeStamper(tsa_url, timeout=5) if tsa_url else None
    _, trusted_time_str = await get_trusted_signing_time(timestamper)
    user_image = resolve_user_image(signer_name, display_email)
    has_prev_sigs = check_has_previous_signatures(pdf_bytes)
    appearance_params = {
        "signer": signer_name,
        "email": display_email,
        "ts": trusted_time_str,
    }
    if request.reason and request.reason.strip():
        appearance_params["reason"] = request.reason.strip()
    if request.location and request.location.strip():
        appearance_params["location"] = request.location.strip()

    is_certify = bool(request.lock_document and not has_prev_sigs)
    lock_all_fields = bool(request.lock_document)

    has_tsa = False
    try:
        pdf_signer = PdfSigner(
            PdfSignatureMetadata(
                field_name=signature_field_name,
                reason=request.reason.strip() if request.reason and request.reason.strip() else None,
                location=request.location.strip() if request.location and request.location.strip() else None,
                name=signer_name,
                md_algorithm="sha256",
                certify=is_certify,
                docmdp_permissions=MDPPerm.NO_CHANGES if is_certify else MDPPerm.FILL_FORMS,
            ),
            signer=signer,
            timestamper=timestamper,
            stamp_style=build_stamp_style(user_image, cuba_time_str=trusted_time_str, reason=request.reason, location=request.location),
            new_field_spec=SigFieldSpec(
                sig_field_name=signature_field_name,
                on_page=request.page,
                box=(x1, y1, x2, y2),
                field_mdp_spec=FieldMDPSpec(action=FieldMDPAction.ALL) if lock_all_fields else None,
                doc_mdp_update_value=MDPPerm.NO_CHANGES if lock_all_fields else None,
            ),
        )
        output = await pdf_signer.async_sign_pdf(
            writer,
            appearance_text_params=appearance_params,
        )
        has_tsa = bool(timestamper is not None)
    except Exception as tsa_err:
        if timestamper is not None:
            writer = IncrementalPdfFileWriter(BytesIO(pdf_bytes))
            writer.find_page_for_modification(request.page)
            pdf_signer = PdfSigner(
                PdfSignatureMetadata(
                    field_name=signature_field_name,
                    reason=request.reason.strip() if request.reason and request.reason.strip() else None,
                    location=request.location.strip() if request.location and request.location.strip() else None,
                    name=signer_name,
                    md_algorithm="sha256",
                    certify=is_certify,
                    docmdp_permissions=MDPPerm.NO_CHANGES if is_certify else MDPPerm.FILL_FORMS,
                ),
                signer=signer,
                timestamper=None,
                stamp_style=build_stamp_style(user_image, cuba_time_str=trusted_time_str, reason=request.reason, location=request.location),
                new_field_spec=SigFieldSpec(
                    sig_field_name=signature_field_name,
                    on_page=request.page,
                    box=(x1, y1, x2, y2),
                    field_mdp_spec=FieldMDPSpec(action=FieldMDPAction.ALL) if lock_all_fields else None,
                    doc_mdp_update_value=MDPPerm.NO_CHANGES if lock_all_fields else None,
                ),
            )
            output = await pdf_signer.async_sign_pdf(
                writer,
                appearance_text_params=appearance_params,
            )
            has_tsa = False
        else:
            raise tsa_err

    result = output.getvalue()
    return {
        "pdf": base64.b64encode(result).decode("ascii"),
        "has_tsa": has_tsa,
        "tsa_type": "RFC 3161" if has_tsa else "ServerTimestamp",
    }

