import { useState } from "react";
import RecipientList from "./RecipientList";
// import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";

function SignerListPlace(props) {
  const { t } = useTranslation();
  const [showHelp, setShowHelp] = useState(false);

  const handleAddRecipient = () => {
    props?.setIsAddSigner(true);
    props.setIsTour && props.setIsTour(false);
  };

  const isRoleView = props.title === t("roles") || props.title === "Roles" || Boolean(props.handleAddSigner);

  return (
    <div>
      <div className="mx-2 pr-2 pt-2 pb-1 text-[15px] text-base-content font-semibold border-b-[1px] border-base-300 flex items-center justify-between">
        <span className="flex items-center">
          {props.title ? props.title : "Recipients"}
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            title="Ayuda sobre roles y orden de firma"
            className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full border border-base-content/40 hover:border-primary hover:text-primary text-[10px] cursor-pointer transition-colors"
          >
            <i className="fa-light fa-question"></i>
          </button>
        </span>
      </div>

      {showHelp && (
        <div className="mx-2 mt-2 mb-2 p-3 bg-base-200 border border-primary/30 rounded-lg shadow-md text-xs text-base-content leading-relaxed relative z-10 animate-fade-in">
          <div className="flex items-center justify-between mb-1.5 font-bold text-primary">
            <span>{isRoleView ? "Información de Roles y Orden" : "Información de Destinatarios"}</span>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="text-base-content/60 hover:text-base-content text-sm ml-2 font-bold leading-none cursor-pointer"
            >
              ×
            </button>
          </div>
          {isRoleView ? (
            <div className="space-y-1.5 text-[11px]">
              <p>
                <strong>Roles:</strong> Representan a los firmantes requeridos en la plantilla (ej. Conrado, Ubalquis, Director).
              </p>
              <p>
                <strong>Numeración:</strong> El orden de los roles en esta lista define la numeración de cada firma (<em>Firma 1, Firma 2...</em>). Puede arrastrar los roles para cambiar su posición.
              </p>
              <p>
                <strong>Orden de firmado:</strong> Si se activa la opción de orden de firmado en el documento, las solicitudes y notificaciones se enviarán secuencialmente en este orden exacto: cada firmante firmará tras completarse el anterior.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 text-[11px]">
              <p>
                <strong>Destinatarios:</strong> Personas que deben firmar este documento.
              </p>
              <p>
                <strong>Orden de firmado:</strong> Si está habilitado el orden de firmado, los firmantes recibirán el correo y firmarán uno a uno siguiendo el orden de esta lista.
              </p>
            </div>
          )}
        </div>
      )}
      <div className="overflow-auto hide-scrollbar max-h-[180px]">
        <RecipientList
          {...props}
        />
      </div>
      <div className="mx-1">
        {props.handleAddSigner ? (
          <div
            role="button"
            data-tut="reactourAddbtn"
            disabled={props?.isMailSend ? true : false}
            className="op-btn op-btn-accent op-btn-outline w-full mt-[14px]"
            onClick={() => props.handleAddSigner()}
          >
            <i className="fa-light fa-plus"></i> {t("add-role")}
          </div>
        ) : (
          <div
            role="button"
            data-tut="addRecipient"
            className="op-btn op-btn-accent op-btn-outline w-full mt-[14px]"
            disabled={props?.isMailSend ? true : false}
            onClick={handleAddRecipient}
          >
            <i className="fa-light fa-plus"></i> {t("add-recipients")}
          </div>
        )}
      </div>
    </div>
  );
}

export default SignerListPlace;