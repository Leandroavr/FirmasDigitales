import { Trans } from "react-i18next";

export const templateReportTour = [
  {
    selector: "[data-tut=reactourFirst]",
    content: <Trans i18nKey="tour-mssg.report-1" />,
    position: "top",
    styles: { fontSize: "11px" }
  },
  {
    selector: "[data-tut=reactourSecond]",
    content: <Trans i18nKey="tour-mssg.redirect" />,
    position: "top",
    styles: { fontSize: "13px" }
  },
  {
    selector: "[data-tut=tourbulksend]",
    content: <Trans i18nKey="tour-mssg.bulksend" />,
    position: "top",
    styles: { fontSize: "13px" }
  },
  {
    selector: "[data-tut=reactourThird]",
    content: (
      <Trans i18nKey="tour-mssg.option">
        This menu reveals more options such as Edit, Delete, Rename, Duplicate,
        Share, etc.
        <a
          className="cursor-pointer op-text-primary"
          href="https://docs.opensignlabs.com/docs/help/Templates/manage-templates"
          target="_blank"
          rel="noopener noreferrer"
        >
          Click here
        </a>
        to read more about all available options.
        <p className="pt-2">
          Nota: Los cambios en una plantilla existente se aplicarán a todos los
          documentos futuros creados a partir de ella, pero no afectarán a los documentos
          que ya hayan sido enviados.
        </p>
      </Trans>
    ),
    position: "top",
    styles: { fontSize: "13px" }
  }
];
