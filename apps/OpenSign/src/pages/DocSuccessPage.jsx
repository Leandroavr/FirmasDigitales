import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Confetti from "react-confetti";
import {
  getBase64FromUrl,
  handleDownloadPdf,
} from "../constant/Utils";
import ModalUi from "../primitives/ModalUi";
import Loader from "../primitives/Loader";
import DownloadPdfZip from "../primitives/DownloadPdfZip";
import CheckCircle from "../primitives/CheckCircle";

const DocSuccessPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signed = window.location?.search?.includes("docid");
  const sent = window.location?.search?.includes("message");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadModal, setIsDownloadModal] = useState(false);
  const [pdfDetails, setPdfDetails] = useState([]);
  const [pdfBase64Url, setPdfBase64Url] = useState("");
  const [showConfetti, setShowConfetti] = useState(true);

  const isCompleted =
    pdfDetails?.[0]?.IsCompleted === true ||
    pdfDetails?.[0]?.IsCompleted === "true";

  const handleConfirm = () => {
    if (localStorage.getItem("accesstoken")) {
      navigate("/");
    } else {
      navigate("/login");
    }
  };

  useEffect(() => {
    initialsetup();
    const timer = setTimeout(() => setShowConfetti(false), 5000);

    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const initialsetup = async () => {
    const search = window.location.search.split("?")[1];
    if (search) {
      const urlParams = new URLSearchParams(search);
      const docId = urlParams.get("docid");
      const docUrl = urlParams.get("docurl");
      const certificate = urlParams.get("certificate");
      const completedParam = urlParams?.get("completed");
      const completed = completedParam === "true" || completedParam === true;
      const details = {
        objectId: docId,
        SignedUrl: docUrl,
        CertificateUrl: certificate,
        IsCompleted: completed,
      };
      setPdfDetails([details]);
      const base64Pdf = await getBase64FromUrl(docUrl);
      if (base64Pdf) {
        setPdfBase64Url(base64Pdf);
      }
    }
  };

  const handleDownload = () => {
    // Descarga directa del PDF sin modal intermedio
    handleDownloadPdf(pdfDetails, setIsDownloading, pdfBase64Url);
    /*
    if (pdfDetails?.[0]?.IsCompleted) {
      setIsDownloadModal(true);
    } else {
      handleDownloadPdf(pdfDetails, setIsDownloading, pdfBase64Url);
    }
    */
  };

  return (
    <>
      {showConfetti && (
        <Confetti width={window.innerWidth} height={window.innerHeight} />
      )}
      {sent ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-3 md:p-8 text-center bg-base-200">
          <div className="max-w-lg md:max-w-xl bg-white rounded-xl shadow-xl p-6 md:p-10 border border-gray-100">
            <CheckCircle className="text-green-500 w-16 h-16 md:w-20 md:h-20 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("doc-sent")}</h1>
            <button
              type="button"
              autoFocus
              className="mt-6 font-medium text-sm md:text-base px-8 py-2.5 op-btn op-btn-primary shadow-md"
              onClick={handleConfirm}
            >
              <span>Aceptar</span>
              <span className="text-xs opacity-75 ml-2 font-mono bg-blue-700 px-1.5 py-0.5 rounded">
                ↵ Enter
              </span>
            </button>
          </div>
        </div>
      ) : signed ? (
        <>
          <div className="min-h-screen flex flex-col items-center justify-center p-3 md:p-8 text-center bg-base-200">
            <div className="max-w-lg md:max-w-xl bg-white rounded-xl shadow-xl p-6 md:p-10 border border-gray-100">
              <div className="flex flex-col items-center space-y-4">
                <CheckCircle className="text-green-500 w-16 h-16 md:w-20 md:h-20" />
                <h1 className="text-2xl md:text-3xl font-bold text-gray-800">
                  {isCompleted
                    ? "¡Documento completado exitosamente!"
                    : "¡Documento firmado correctamente!"}
                </h1>
                <p className="text-sm md:text-base text-gray-600 leading-relaxed max-w-md">
                  {isCompleted
                    ? "Todas las partes han completado el proceso de firma. El documento oficial sellado ha sido generado y enviado a su correo electrónico."
                    : "Su firma ha sido registrada exitosamente. El documento continuará con los siguientes firmantes. Una vez finalizado por todas las partes, recibirá la copia oficial sellada por correo."}
                </p>
              </div>

              {/* Botón de confirmación con Enter */}
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  autoFocus
                  className="w-full sm:w-auto font-medium text-sm md:text-base px-8 py-2.5 op-btn op-btn-primary shadow-md hover:shadow-lg transition-all"
                  onClick={handleConfirm}
                >
                  <span>Aceptar</span>
                  <span className="text-xs opacity-75 ml-2 font-mono bg-blue-700 px-1.5 py-0.5 rounded">
                    ↵ Enter
                  </span>
                </button>

                {/* Descargar SOLO si está completado todo */}
                {isCompleted && (
                  <button
                    type="button"
                    className="w-full sm:w-auto font-medium text-sm md:text-base px-6 py-2.5 op-btn op-btn-outline"
                    onClick={() => handleDownload()}
                  >
                    <i className="fa-light fa-download mr-1.5" aria-hidden="true"></i>
                    <span>Descargar documento</span>
                  </button>
                )}
              </div>

              {/* Pie de mensaje */}
              <p className="mt-6 text-xs text-gray-400">
                Firma Digital Brascuba
              </p>
            </div>
          </div>
          {isDownloading === "pdf" && (
            <div className="fixed z-[1000] inset-0 flex justify-center items-center bg-black bg-opacity-30">
              <Loader />
            </div>
          )}
          <ModalUi
            isOpen={
              isDownloading === "certificate" ||
              isDownloading === "certificate_err"
            }
            title={
              isDownloading === "certificate" ||
              isDownloading === "certificate_err"
                ? t("generating-certificate")
                : t("pdf-download")
            }
            handleClose={() => setIsDownloading("")}
          >
            <div className="p-3 md:p-5 text-sm md:text-base text-center text-base-content">
              {isDownloading === "certificate" ? (
                <p>{t("generate-certificate-alert")}</p>
              ) : (
                <p>{t("generate-certificate-err")}</p>
              )}
            </div>
          </ModalUi>
          <DownloadPdfZip
            setIsDownloadModal={setIsDownloadModal}
            isDownloadModal={isDownloadModal}
            pdfDetails={pdfDetails}
            isDocId={true}
            pdfBase64={pdfBase64Url}
          />
        </>
      ) : (
        <></>
      )}
    </>
  );
};

export default DocSuccessPage;
