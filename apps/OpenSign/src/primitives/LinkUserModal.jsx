import { useEffect, useState } from "react";
import SelectSigners from "../components/shared/fields/SelectSigners";
import ModalUi from "./ModalUi";
import { useTranslation } from "react-i18next";

const LinkUserModal = (props) => {
  const { t } = useTranslation();
  const [isExistSigner, setIsExistSIgner] = useState(false);

  useEffect(() => {
    if (props.uniqueId) {
      const isExistSigner = props.signerPos.find(
        (x) => x.Id === props.uniqueId && x.signerObjId
      );
      setIsExistSIgner(isExistSigner);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.signerPos]);
  return (
    <ModalUi
      title={isExistSigner ? t("change-signer") : t("add/choose-signer")}
      isOpen={true}
      handleClose={props.closePopup}
    >
      <SelectSigners
        {...props}
        isExistSigner={isExistSigner}
      />
    </ModalUi>
  );
};

export default LinkUserModal;
