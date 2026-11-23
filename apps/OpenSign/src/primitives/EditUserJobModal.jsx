import React, { useState, useEffect } from "react";
import Parse from "parse";
import ModalUi from "./ModalUi";
import Loader from "./Loader";
import { useTranslation } from "react-i18next";
import { HIERARCHY_LEVELS } from "../constant/const";
import SuperiorSearchSelect from "./SuperiorSearchSelect";

function formatDisplayName(raw, email) {
  if (!raw && email) raw = email.split("@")[0];
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return trimmed
      .split(".")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
  return trimmed;
}

const EditUserJobModal = ({ isOpen, user, allUsers = [], handleClose, onSuccess, showAlert }) => {
  const { t } = useTranslation();
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [hierarchyLevel, setHierarchyLevel] = useState("Especialista / Base");
  const [reportsTo, setReportsTo] = useState("");
  const [userRole, setUserRole] = useState("contracts_User");
  const [bossUserId, setBossUserId] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setJobTitle(user?.JobTitle || "");
      setDepartment(user?.Department || "");
      setHierarchyLevel(user?.HierarchyLevel || "Especialista / Base");
      setReportsTo(user?.ReportsTo || "");
      setUserRole(user?.UserRole || "contracts_User");
      setBossUserId(
        user?.BossPtr?.objectId || (typeof user?.BossPtr === "string" ? user.BossPtr : "")
      );
    }
  }, [user]);

  // Lista de posibles superiores (excluyendo al usuario actual, al admin general y a otras secretarias)
  const availableSuperiors = (allUsers || []).filter((u) => {
    const isSelf = u.objectId === user?.objectId || u.Email === user?.Email;
    const isAdmin = (u.Email || "").toLowerCase().trim() === "admin@brascuba.cu";
    const isSecretary = u.UserRole === "contracts_Secretary";
    return !isSelf && !isAdmin && !isSecretary;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedJob = jobTitle.trim();
    const trimmedDept = department.trim();

    if (!trimmedJob) {
      alert("El cargo es obligatorio y no puede estar vacío.");
      return;
    }
    if (!trimmedDept) {
      alert("El departamento es obligatorio y no puede estar vacío.");
      return;
    }
    const effectiveBossId = userRole === "contracts_Secretary" ? (reportsTo || bossUserId) : null;
    if (userRole === "contracts_Secretary" && !effectiveBossId) {
      alert("Debe seleccionar el Jefe Inmediato al que asiste la secretaria.");
      return;
    }

    const effectiveHierarchy = userRole === "contracts_Secretary" ? "Secretaría" : hierarchyLevel;

    setIsLoading(true);
    try {
      const res = await Parse.Cloud.run("updateUserJobAndDepartment", {
        extUserId: user.objectId,
        jobTitle: trimmedJob,
        department: trimmedDept,
        hierarchyLevel: effectiveHierarchy,
        reportsTo: userRole === "contracts_Secretary" ? effectiveBossId : reportsTo,
        userRole: userRole,
        bossUserId: effectiveBossId,
      });

      if (res && res.status === "success") {
        if (showAlert) showAlert("success", res.message || "Usuario actualizado exitosamente.");
        const selectedBoss = (allUsers || []).find((u) => u.objectId === effectiveBossId);
        if (onSuccess) onSuccess(user.objectId, trimmedJob, trimmedDept, effectiveHierarchy, reportsTo, userRole, selectedBoss);
        handleClose();
      } else {
        alert(res?.message || t("something-went-wrong-mssg"));
      }
    } catch (err) {
      console.error("Error al actualizar organigrama del usuario:", err);
      alert(err?.message || t("something-went-wrong-mssg"));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalUi
      isOpen={isOpen}
      title="Ubicación en el Organigrama"
      handleClose={!isLoading ? handleClose : undefined}
    >
      <div className="p-4 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-base-100/70 z-50 flex flex-col justify-center items-center">
            <Loader />
            <span className="text-xs mt-2 text-base-content font-medium">Guardando cambios...</span>
          </div>
        )}

        <div className="mb-3 p-3 bg-base-200 rounded-lg text-xs space-y-1">
          <p>
            <strong className="text-base-content">Usuario:</strong>{" "}
            {formatDisplayName(user?.Name, user?.Email) || "-"}
          </p>
          <p>
            <strong className="text-base-content">Correo:</strong> {user?.Email || "-"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold mb-1 text-base-content">
              Cargo / Puesto <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={isLoading}
              className="op-input op-input-bordered op-input-sm w-full text-xs"
              placeholder="ej: Gerente IT, Especialista, etc."
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-base-content">
              Departamento <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={isLoading}
              className="op-input op-input-bordered op-input-sm w-full text-xs"
              placeholder="ej: Dirección TI, Gerencia Comercial, etc."
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </div>

          <div className="pt-2 border-t border-base-200">
            <label className="block text-xs font-semibold mb-1 text-base-content">
              Rol en la Plataforma <span className="text-red-500">*</span>
            </label>
            <select
              disabled={isLoading}
              className="op-select op-select-bordered op-select-sm w-full text-xs font-medium cursor-pointer"
              value={userRole}
              onChange={(e) => {
                setUserRole(e.target.value);
              }}
            >
              <option value="contracts_User">Usuario Estándar</option>
              <option value="contracts_Secretary">Secretaría</option>
              <option value="contracts_Admin">Administrador</option>
            </select>
          </div>

          {userRole === "contracts_Secretary" ? (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg">
              <span className="block text-[11px] font-bold text-rose-900 uppercase tracking-wide">
                Condición en Organigrama
              </span>
              <span className="text-xs font-semibold text-rose-800">
                Secretaría (Asistencia a Dirección / Presidencia - Fuera de Organigrama)
              </span>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold mb-1 text-base-content">
                Nivel Jerárquico en la Empresa <span className="text-red-500">*</span>
              </label>
              <select
                disabled={isLoading}
                className="op-select op-select-bordered op-select-sm w-full text-xs"
                value={hierarchyLevel}
                onChange={(e) => setHierarchyLevel(e.target.value)}
              >
                {HIERARCHY_LEVELS.map((lvl) => (
                  <option key={lvl.value} value={lvl.value}>
                    {lvl.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <SuperiorSearchSelect
              value={reportsTo}
              onChange={(val) => setReportsTo(val)}
              superiorsList={availableSuperiors}
              disabled={isLoading}
              label={
                userRole === "contracts_Secretary"
                  ? "Jefe Inmediato al que asiste *"
                  : "Superior directo / Reporta a"
              }
              hint={
                userRole === "contracts_Secretary"
                  ? "Selecciona al Presidente, Director, Subdirector o Gerente al que asistirá la secretaria."
                  : "Selecciona a la persona de la cual depende en el organigrama para estructurar el árbol."
              }
            />
          </div>

          <hr className="border-base-300 mt-4" />

          <div className="flex justify-end items-center gap-2 mt-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleClose}
              className="op-btn op-btn-secondary op-btn-sm text-xs"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="op-btn op-btn-primary op-btn-sm text-xs !text-white"
            >
              {t("save")}
            </button>
          </div>
        </form>
      </div>
    </ModalUi>
  );
};

export default EditUserJobModal;
