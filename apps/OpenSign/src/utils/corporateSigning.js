import forge from "node-forge";

const toBinaryString = (bytes) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return binary;
};

const toBase64 = (binary) => window.btoa(binary);

const getCertificateEmail = (certificate) => {
  const subjectEmail = certificate.subject.getField("E")?.value;
  const alternativeNames =
    certificate.extensions.find((extension) => extension.name === "subjectAltName")
      ?.altNames || [];
  const sanEmail = alternativeNames.find((entry) => entry.type === 1)?.value;
  return String(subjectEmail || sanEmail || "").toLowerCase();
};

function getCNsFromAsn1(asn1Obj) {
  if (!asn1Obj) return [];
  const cnOidDer = forge.asn1.oidToDer("2.5.4.3").getBytes();
  const cns = [];
  function search(node) {
    if (!node) return;
    if (Array.isArray(node.value)) {
      for (let i = 0; i < node.value.length; i++) {
        const child = node.value[i];
        if (child && child.type === forge.asn1.Type.OID && child.value === cnOidDer) {
          const valNode = node.value[i + 1] || node.value[1];
          if (valNode && typeof valNode.value === "string") {
            try {
              cns.push(forge.util.decodeUtf8(valNode.value));
            } catch (e) {
              cns.push(valNode.value);
            }
          }
        }
        search(child);
      }
    }
  }
  search(asn1Obj);
  return cns;
}

export async function loadCorporateP12(file, password, fallbackEmail = "") {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const p12Asn1 = forge.asn1.fromDer(toBinaryString(fileBytes));
  let p12;
  const passwordsToTry = [];
  if (typeof password === "string") {
    passwordsToTry.push(password);
    if (password.trim() !== password) {
      passwordsToTry.push(password.trim());
    }
    if (
      (password.startsWith('"') && password.endsWith('"')) ||
      (password.startsWith("'") && password.endsWith("'"))
    ) {
      const stripped = password.slice(1, -1);
      passwordsToTry.push(stripped);
      if (stripped.trim() !== stripped) {
        passwordsToTry.push(stripped.trim());
      }
    }
  } else {
    passwordsToTry.push(password);
  }

  let lastError = null;
  for (const pw of passwordsToTry) {
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pw);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!p12) {
    console.error("Error al abrir PKCS#12:", lastError);
    const msg = lastError?.message || "";
    if (msg.includes("MAC could not be verified")) {
      throw new Error(
        "Contraseña incorrecta: la verificación de integridad (MAC) del archivo .p12 falló. Verifica si la contraseña tiene mayúsculas, minúsculas, espacios adicionales o si la copiaste con comillas."
      );
    }
    throw new Error(`Error al leer el certificado .p12: ${msg}`);
  }

  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || [];
  const legacyKeyBags =
    p12.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ] || [];
  const certificates =
    p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] || [];
  const allKeyBags = [...keyBags, ...legacyKeyBags];
  const privateKey = allKeyBags.find((b) => b.key)?.key;
  const isEcdsaKey = !privateKey || !privateKey.n || !privateKey.e;

  let certificate = null;
  let certAsn1 = null;

  if (!isEcdsaKey) {
    const certificateBag =
      certificates.find(
        ({ cert }) =>
          cert?.publicKey?.n &&
          privateKey?.n &&
          cert.publicKey.n.compareTo(privateKey.n) === 0
      ) || certificates[0];
    certificate = certificateBag?.cert || null;
    certAsn1 = certificateBag?.asn1 || null;
  } else {
    certificate = certificates[0]?.cert || null;
    certAsn1 = certificates[0]?.asn1 || null;
  }

  // If node-forge parsed cert, check validity
  if (certificate) {
    const now = new Date();
    const skewToleranceMs = 86400 * 1000;
    if (certificate.validity.notBefore.getTime() - skewToleranceMs > now.getTime()) {
      throw new Error(
        `El certificado aún no es válido (su vigencia inicia el ${certificate.validity.notBefore.toLocaleDateString()}).`
      );
    }
    if (certificate.validity.notAfter.getTime() + skewToleranceMs < now.getTime()) {
      throw new Error(
        `El certificado ha expirado (su vigencia expiró el ${certificate.validity.notAfter.toLocaleDateString()}).`
      );
    }
  }

  let commonName = certificate?.subject?.getField("CN")?.value;
  let certEmail = certificate ? getCertificateEmail(certificate) : "";

  // If node-forge couldn't parse the cert object (because it's ECDSA), extract CN from ASN.1
  if (!commonName && certAsn1) {
    const cns = getCNsFromAsn1(certAsn1);
    commonName = cns[cns.length - 1] || "";
  }
  if (!commonName) {
    commonName = String(fallbackEmail || "").split("@")[0];
  }

  const isEcdsa = isEcdsaKey || !certificate;
  const effectiveEmail = certEmail || String(fallbackEmail || "").toLowerCase();

  let certDerBase64 = null;
  if (certificate) {
    certDerBase64 = toBase64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()
    );
  } else if (certAsn1) {
    certDerBase64 = toBase64(forge.asn1.toDer(certAsn1).getBytes());
  }

  return {
    isEcdsa,
    privateKey: isEcdsa ? null : privateKey,
    certificate,
    certificateChain: certificates.map(({ cert }) => cert).filter(Boolean),
    email: effectiveEmail,
    hasCertificateEmail: Boolean(certEmail),
    name: commonName,
    p12Base64: toBase64(toBinaryString(fileBytes)),
    certificateDer: certDerBase64
  };
}

export function normalizeIdentityText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .trim();
}

export function areNamesCompatible(nameA, nameB) {
  const normA = normalizeIdentityText(nameA);
  const normB = normalizeIdentityText(nameB);
  if (!normA || !normB) return true;
  if (normA === normB) return true;

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);
  const setB = new Set(tokensB);

  let common = 0;
  for (const token of tokensA) {
    if (setB.has(token)) common++;
  }

  if (common >= 2) return true;
  if (tokensA.length === 1 && setB.has(tokensA[0])) return true;
  const setA = new Set(tokensA);
  if (tokensB.length === 1 && setA.has(tokensB[0])) return true;

  return false;
}

export function areEmailsCompatible(emailA, emailB) {
  const cleanA = String(emailA || "").trim().toLowerCase();
  const cleanB = String(emailB || "").trim().toLowerCase();
  if (!cleanA || !cleanB) return true;
  if (cleanA === cleanB) return true;

  const userA = cleanA.split("@")[0];
  const userB = cleanB.split("@")[0];
  if (userA && userB && userA === userB) return true;

  return false;
}

export function validateSignerIdentity(
  credentials,
  expectedEmail,
  expectedName,
  roleDescription = "el firmante asignado"
) {
  if (!credentials) return;
  if (credentials.hasCertificateEmail) {
    const emailMatch = areEmailsCompatible(credentials.email, expectedEmail);
    const nameMatch = areNamesCompatible(credentials.name, expectedName);

    if (!emailMatch && !nameMatch) {
      throw new Error(
        `El certificado (${credentials.name} <${credentials.email}>) no coincide con ${roleDescription} (${expectedName || expectedEmail}).`
      );
    }
  } else {
    if (expectedName && !areNamesCompatible(credentials.name, expectedName)) {
      throw new Error(
        `El certificado (${credentials.name}) no coincide con el nombre asignado (${expectedName}).`
      );
    }
  }
}

export async function signPreparedPdfWithP12(credentials, prepared) {
  const preparedPdf = Uint8Array.from(
    window.atob(prepared.preparedPdf),
    (character) => character.charCodeAt(0)
  );
  const [firstStart, firstLength, secondStart, secondLength] =
    prepared.byteRange;
  if (
    firstStart !== 0 ||
    firstLength <= 0 ||
    secondStart <= firstLength ||
    secondLength <= 0 ||
    secondStart + secondLength > preparedPdf.length
  ) {
    throw new Error("El PDF preparado tiene un rango de bytes de firma no válido.");
  }

  const signedContent = new Uint8Array(firstLength + secondLength);
  signedContent.set(preparedPdf.subarray(firstStart, firstStart + firstLength));
  signedContent.set(
    preparedPdf.subarray(secondStart, secondStart + secondLength),
    firstLength
  );
  const digest = forge.md.sha256
    .create()
    .update(toBinaryString(signedContent))
    .digest()
    .getBytes();
  if (toBase64(digest) !== prepared.digest) {
    throw new Error("El resumen (digest) del PDF preparado no pudo ser verificado.");
  }

  const signedData = forge.pkcs7.createSignedData();
  signedData.content = forge.util.createBuffer(toBinaryString(signedContent));
  signedData.addSigner({
    key: credentials.privateKey,
    certificate: credentials.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data
      },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ]
  });
  signedData.addCertificate(credentials.certificate);
  for (const certificate of credentials.certificateChain) {
    if (certificate !== credentials.certificate) {
      signedData.addCertificate(certificate);
    }
  }
  signedData.sign({ detached: true });

  const derSignature = forge.asn1.toDer(signedData.toAsn1()).getBytes();
  return toBase64(derSignature);
}
