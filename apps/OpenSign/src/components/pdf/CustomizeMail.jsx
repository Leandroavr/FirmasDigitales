import { useState } from "react";
import ModalUi from "../../primitives/ModalUi";
import { EmailBody } from "./EmailBody";
import {
  contractDocument,
  defaultMailBody,
  defaultMailSubject,
  sendEmailToSigners
} from "../../constant/Utils";
import { useTranslation } from "react-i18next";
import Loader from "../../primitives/Loader";
import { useNavigate } from "react-router";

const statusMap = {
  success: "success",
  "quota-reached": "quotareached",
};
function CustomizeMail(props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isCustomize, setIsCustomize] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [isLoader, setIsLoader] = useState(false);

  const handleCloseSendmailModal = () => {
    if (props?.handleClose) {
      props?.handleClose();
      return;
    }
    props?.setIsMailModal(false);
    navigate("/report/1MwEuxLEkF");
  };

  const handleEmailSendToSigners = async () => {
    setIsLoader(true);
    const documentData = await contractDocument(props?.documentId);
    if (documentData && documentData?.length > 0) {
      props?.setDocumentDetails && props?.setDocumentDetails(documentData[0]);
      if (
        documentData?.[0]?.SendinOrder &&
        documentData?.[0]?.SendinOrder === true
      ) {
        const ownerEmail = documentData[0].ExtUserPtr.Email;
        const ownerDetails = documentData[0].Signers.find(
          (x) => x.Email === ownerEmail
        );
        props?.setCurrUserId && props?.setCurrUserId(ownerDetails?.objectId);
      }
      const customMail = {
        body:
          props?.emailEditorType === "basic"
            ? props?.customizeMail?.body?.basic
            : props?.customizeMail?.body?.advanced,
        subject: props?.customizeMail?.subject
      };
      //function is used to send email to signers for sign the document
      const mailRes = await sendEmailToSigners(
        documentData,
        props?.signerList,
        customMail,
        props?.defaultMail,
        isCustomize,
      );
      props?.setIsMailModal(false);
      props?.setIsSend(true);
      setIsLoader(false);
      props?.setMailStatus(statusMap[mailRes?.status] ?? "failed");
    } else {
      alert("something-went-wrong-mssg");
    }
  };

  const handleReset = () => {
    setIsReset(true);
    props?.setCustomizeMail({
      subject: defaultMailSubject,
      body: { basic: defaultMailBody, advanced: defaultMailBody }
    });
  };
  const onChangeSubject = (value) => {
    setIsReset(false);
    props?.setCustomizeMail((prev) => ({ ...prev, subject: value }));
  };

  const onChangeBody = (newValue, changedType) => {
    setIsReset(false);
    props?.setCustomizeMail((prev) => ({
      ...prev,
      body: { ...prev.body, [changedType]: newValue }
    }));
  };
  const handleSwitch = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const editor = props?.emailEditorType === "basic" ? "advanced" : "basic";
    props.setEmailEditorType(editor);
  };

  return (
    <>
      {isLoader ? (
        <div className="absolute w-full h-full flex justify-center items-center bg-black/30 rounded-box z-30">
          <Loader />
        </div>
      ) : (
        <ModalUi
          isOpen={props?.isMailModal}
          title={t("send-mail")}
          handleClose={() => handleCloseSendmailModal()}
        >
          <div className="max-h-96 overflow-y-scroll scroll-hide p-[20px] text-base-content">
            <span>{t("placeholder-alert-3")}</span>
            <div className="flex flex-row items-center gap-2 mt-4">
              <button
                onClick={() => handleEmailSendToSigners()}
                className="op-btn op-btn-primary font-[500] text-sm shadow px-6"
              >
                {t("send")}
              </button>
            </div>

            <div className="mt-5 pt-3 border-t border-base-300">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {t("signers") || "Firmantes convocados"}:
              </div>
              <div className="space-y-1.5">
                {props?.signerList?.map((s, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm text-base-content py-1.5 px-3 rounded-lg bg-base-200/70"
                  >
                    <i className="fa-light fa-user text-primary text-xs"></i>
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {s?.Name || s?.Role || `Firmante ${idx + 1}`}
                    </span>
                    <span className="text-gray-400 text-xs">({s?.Email})</span>
                  </div>
                ))}
              </div>
            </div>
            <p id="copyUrl" ref={props?.copyUrlRef} className="hidden"></p>
          </div>
        </ModalUi>
      )}
    </>
  );
}

export default CustomizeMail;
