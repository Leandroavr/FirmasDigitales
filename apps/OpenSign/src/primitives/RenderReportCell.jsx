import { useTranslation } from "react-i18next";
import { formatDateToDdMmmYyyy, getSignerDisplayName } from "../constant/Utils";
import SignerCell from "./SignerCell";

function isValidDateString(str) {
  const date = new Date(str);
  return !isNaN(date.getTime());
}
// `formatRow` is used to show data in poper manner like
// if data is of array type then it will join array items with ","
// if data is of object type then it Name values will be show in row
// if no data available it will show hyphen "-"
const formatRow = (row) => {
  if (Array.isArray(row)) {
    return row.map((x) => x.Name).join(", ");
  } else if (typeof row === "object" && row !== null) {
    return row?.iso ? formatDateToDdMmmYyyy(row?.iso) : row?.Name || "-";
  } else if (typeof row === "boolean" && row !== null) {
    return row ? row?.toString() : "false";
  } else if (isValidDateString(row) && row !== null) {
    // handle createdAt and updatedAt
    return formatDateToDdMmmYyyy(row) || "-";
  } else {
    return row || "-";
  }
};
// Renders a report cell based on the report's heading position
export const RenderReportCell = ({
  col,
  rowData,
  rowIndex,
  startIndex,
  handleDownload,
  handleRemovePrefill,
  reportName,
  handleItemClick
}) => {
  const { t } = useTranslation();
  const appName = "OpenSign™";
  const drivename = appName === "OpenSign™" ? "OpenSign™" : "";
  switch (col) {
    case "Sr.No":
      return (
        <th key={col} className="px-3 py-3">
          {startIndex + rowIndex + 1}
        </th>
      );
    case "Name":
    case "Title": {
      const docType =
        rowData?.DocumentType || rowData?.TemplateId?.DocumentType;
      return (
        <td key={col} className="py-3 px-3 min-w-[200px] max-w-[260px]">
          <div
            className="text-[13px] font-semibold break-words leading-snug text-gray-800"
            title={rowData?.Name}
          >
            {rowData?.Name}
          </div>
          {docType && (
            <div className="mt-1">
              <span
                className="inline-block text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded leading-tight break-words"
                title={`Tipo de documento: ${docType}`}
              >
                {docType}
              </span>
            </div>
          )}
          {rowData?.Note && (
            <div
              className="mt-1.5 text-[11px] text-gray-500 italic flex items-center gap-1.5 cursor-pointer hover:text-gray-700"
              title={rowData.Note}
              onClick={() =>
                handleItemClick && handleItemClick("Note", rowData.Note)
              }
            >
              <i className="fa-light fa-note-sticky text-amber-500 shrink-0"></i>
              <span className="truncate max-w-[280px]">{rowData.Note}</span>
            </div>
          )}
        </td>
      );
    }
    case "Reason":
      return (
        <td
          key={col}
          className="py-3 px-3 text-center cursor-pointer"
          onClick={() => handleItemClick(col, rowData?.DeclineReason)}
        >
          {rowData?.DeclineReason?.length > 25
            ? rowData?.DeclineReason?.slice(0, 25) + "..."
            : rowData?.DeclineReason || "-"}
        </td>
      );
    case "Note":
      return (
        <td key={col} className="py-3 px-3 text-center">
          <p
            className="truncate w-[100px] cursor-pointer"
            onClick={() => handleItemClick(col, rowData?.Note)}
          >
            {rowData?.Note || "-"}
          </p>
        </td>
      );
    case "Folder":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.Folder?.Name ||
            t("sidebar.OpenSign™ Drive", { appName: drivename })}
        </td>
      );
    case "File":
      if (!rowData?.IsCompleted) {
        return (
          <td key={col} className="py-3 px-3 text-center text-gray-400">
            -
          </td>
        );
      }
      return (
        <td key={col} className="py-3 px-3 text-center">
          <button
            onClick={() => handleDownload(rowData)}
            className="op-link op-link-primary"
            title={t("download")}
          >
            {rowData?.URL ? t("download") : "-"}
          </button>
        </td>
      );
    case "Owner": {
      const ownerName = getSignerDisplayName(rowData?.ExtUserPtr);
      const ownerEmail = rowData?.ExtUserPtr?.Email || "";
      return (
        <td key={col} className="py-3 px-3 text-center whitespace-nowrap">
          <span
            className="font-medium text-gray-800 cursor-default"
            title={ownerEmail}
          >
            {ownerName}
          </span>
        </td>
      );
    }
    case "Time to complete (Days)":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.TimeToCompleteDays || "-"}
        </td>
      );
    case "Notify on signatures":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.NotifyOnSignatures?.toString() || "-"}
        </td>
      );
    case "Enable Tour":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.IsTourEnabled?.toString() || "-"}
        </td>
      );
    case "Redirect url":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.RedirectUrl?.toString() || "-"}
        </td>
      );
    case "Dates": {
      const createdAt = rowData?.createdAt
        ? formatDateToDdMmmYyyy(rowData.createdAt)
        : null;
      const sentRaw = rowData?.DocSentAt?.iso || rowData?.DocSentAt;
      const sentAt = sentRaw ? formatDateToDdMmmYyyy(sentRaw) : null;
      const updatedAt = rowData?.updatedAt
        ? formatDateToDdMmmYyyy(rowData.updatedAt)
        : null;
      const expiryIso = rowData?.ExpiryDate?.iso;
      let expiryFormatted = null;
      let countdownText = "";
      let isUrgent = false;

      if (expiryIso) {
        expiryFormatted = formatDateToDdMmmYyyy(expiryIso);
        const expiryDate = new Date(expiryIso);
        const now = new Date();

        // Comparar días de calendario a medianoche local para evitar desfasajes horarios
        const expiryMidnight = new Date(
          expiryDate.getFullYear(),
          expiryDate.getMonth(),
          expiryDate.getDate()
        );
        const todayMidnight = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const diffMs = expiryMidnight.getTime() - todayMidnight.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays > 1) {
          countdownText = `(${diffDays} días)`;
        } else if (diffDays === 1) {
          countdownText = "(1 día)";
          isUrgent = true;
        } else if (diffDays === 0) {
          countdownText = "(Expira hoy)";
          isUrgent = true;
        } else {
          // diffDays < 0 significa que venció ayer o antes
          countdownText = rowData?.IsCompleted ? "" : "(Expirado)";
          isUrgent = !rowData?.IsCompleted;
        }
      }

      return (
        <td
          key={col}
          className="py-3 px-3 text-left whitespace-nowrap text-[12px] leading-relaxed text-gray-600"
        >
          <div className="flex flex-col gap-1">
            {createdAt && (
              <div>
                <span className="font-semibold text-gray-700">Creado:</span>{" "}
                <span>{createdAt}</span>
              </div>
            )}
            {sentAt && (
              <div>
                <span className="font-semibold text-gray-700">Envío:</span>{" "}
                <span>{sentAt}</span>
              </div>
            )}
            {updatedAt && (
              <div>
                <span className="font-semibold text-gray-700">
                  Actualizado:
                </span>{" "}
                <span>{updatedAt}</span>
              </div>
            )}
            {expiryFormatted && (
              <div className={isUrgent ? "text-amber-600 font-medium" : ""}>
                <span className="font-semibold text-gray-700">Expira:</span>{" "}
                <span>{expiryFormatted}</span>{" "}
                {countdownText && (
                  <span
                    className={`text-[11px] font-semibold ${isUrgent ? "text-amber-600" : "text-gray-500"}`}
                  >
                    {countdownText}
                  </span>
                )}
              </div>
            )}
            {!createdAt && !sentAt && !updatedAt && !expiryFormatted && (
              <span>-</span>
            )}
          </div>
        </td>
      );
    }
    case "Created Date":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.createdAt ? formatDateToDdMmmYyyy(rowData?.createdAt) : "-"}
        </td>
      );
    case "Updated Date":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.updatedAt ? formatDateToDdMmmYyyy(rowData?.updatedAt) : "-"}
        </td>
      );
    case "Expiry Date":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.ExpiryDate
            ? formatDateToDdMmmYyyy(rowData?.ExpiryDate?.iso)
            : "-"}
        </td>
      );
    case "Sent Date":
      return (
        <td key={col} className="py-3 px-3 text-center">
          {rowData?.DocSentAt
            ? formatDateToDdMmmYyyy(rowData?.DocSentAt?.iso)
            : "-"}
        </td>
      );
    case "Signers":
      return (
        <SignerCell
          key={col}
          reportName={reportName}
          item={rowData}
          handleRemovePrefill={handleRemovePrefill}
        />
      );
    default:
      return (
        <td key={col} className="py-3 px-3 text-center">
          {Array.isArray(rowData[col]) ? (
            <div className="flex flex-row flex-wrap gap-1 justify-center">
              {rowData[col].map((x, i) => (
                <span key={i}>{formatRow(x)}</span>
              ))}
            </div>
          ) : (
            formatRow(rowData[col])
          )}
        </td>
      );
  }
};
