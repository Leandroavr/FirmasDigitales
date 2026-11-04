import React, { useEffect, useState, useMemo } from "react";
import Parse from "parse";
import Alert from "../primitives/Alert";
import Loader from "../primitives/Loader";
import { useLocation, useNavigate } from "react-router";
import ModalUi from "../primitives/ModalUi";
import pad from "../assets/images/pad.svg";
import Tooltip from "../primitives/Tooltip";
import AddUser from "../components/AddUser";
import { useTranslation } from "react-i18next";
import DeleteUserModal from "../primitives/DeleteUserModal";
import axios from "axios";
import PasswordResetModal from "../primitives/PasswordResetModal";
import EditUserJobModal from "../primitives/EditUserJobModal";
import { usersActions } from "../json/ReportJson";
import { withSessionValidation } from "../utils";

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

const LEVEL_CONFIG = {
  "Presidencia": {
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
    icon: "fa-crown",
  },
  "Dirección": {
    badgeClass: "bg-purple-100 text-purple-900 border-purple-300",
    icon: "fa-user-tie",
  },
  "Gerencia": {
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
    icon: "fa-briefcase",
  },
  "Jefatura de Grupo": {
    badgeClass: "bg-teal-100 text-teal-900 border-teal-300",
    icon: "fa-users-gear",
  },
  "Especialista / Base": {
    badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
    icon: "fa-user",
  },
};

const UserList = () => {
  const { t } = useTranslation();
  const [userList, setUserList] = useState([]);
  const [isLoader, setIsLoader] = useState(false);
  const [isModal, setIsModal] = useState({
    form: false,
    addseats: false,
    options: false
  });
  const location = useLocation();
  const isDashboard =
    location?.pathname === "/dashboard/35KBoSgoAK" ? true : false;
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();
  const [isAlert, setIsAlert] = useState({ type: "success", msg: "" });
  const [isActiveModal, setIsActiveModal] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [formHeader, setFormHeader] = useState(t("add-user"));
  const [deleteUserRes, setDeleteUserRes] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [isActModal, setIsActModal] = useState({});
  const Extand_Class = localStorage.getItem("Extand_Class");
  const extClass = Extand_Class && JSON.parse(Extand_Class);

  // Estados para vista compacta, búsqueda y ficha del usuario
  const [viewMode, setViewMode] = useState("table"); // 'table' | 'cards'
  const [detailUser, setDetailUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const checkIsSuperAdmin = (u) => {
    if (!u) return false;
    return (
      u.isSuperAdmin === true ||
      u.Email === "admin@brascuba.cu" ||
      u.email === "admin@brascuba.cu" ||
      u.UserId?.isSuperAdmin === true ||
      u.UserId?.email === "admin@brascuba.cu"
    );
  };
  const [isSuperAdmin, setIsSuperAdmin] = useState(() => checkIsSuperAdmin(extClass?.[0]));
  const [storageStats, setStorageStats] = useState(null);

  const recordperPage = 10;

  // Filtrado de usuarios en tiempo real
  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) return userList;
    const term = searchTerm.trim().toLowerCase();
    return userList.filter((u) => {
      const name = formatDisplayName(u?.Name, u?.Email).toLowerCase();
      const email = (u?.Email || "").toLowerCase();
      const job = (u?.JobTitle || "").toLowerCase();
      const dept = (u?.Department || "").toLowerCase();
      const lvl = (u?.HierarchyLevel || "").toLowerCase();
      return name.includes(term) || email.includes(term) || job.includes(term) || dept.includes(term) || lvl.includes(term);
    });
  }, [userList, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / recordperPage));
  const startIndex = (currentPage - 1) * recordperPage;
  const indexOfLastDoc = currentPage * recordperPage;
  const indexOfFirstDoc = indexOfLastDoc - recordperPage;
  const currentList = filteredUsers.slice(indexOfFirstDoc, indexOfLastDoc);

  const getPaginationRange = () => {
    const totalPageNumbers = 7;
    const pages = [];
    if (totalPages <= totalPageNumbers) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      const leftSiblingIndex = Math.max(currentPage - 1, 1);
      const rightSiblingIndex = Math.min(currentPage + 1, totalPages);
      const showLeftDots = leftSiblingIndex > 2;
      const showRightDots = rightSiblingIndex < totalPages - 2;

      if (!showLeftDots && showRightDots) {
        let leftItemCount = 3;
        let leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);
        pages.push(...leftRange, "...", totalPages);
      } else if (showLeftDots && !showRightDots) {
        let rightItemCount = 3;
        let rightRange = Array.from({ length: rightItemCount }, (_, i) => totalPages - rightItemCount + i + 1);
        pages.push(1, "...", ...rightRange);
      } else if (showLeftDots && showRightDots) {
        let middleRange = Array.from({ length: 3 }, (_, i) => leftSiblingIndex + i);
        pages.push(1, "...", ...middleRange, "...", totalPages);
      }
    }
    return pages;
  };
  const pageNumbers = getPaginationRange();

  useEffect(() => {
    fetchUserList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchUserList() {
    try {
      setIsLoader(true);
      const extUser =
        localStorage.getItem("Extand_Class") &&
        JSON.parse(localStorage.getItem("Extand_Class"))?.[0];

      if (extUser) {
        const admin = extUser?.UserRole === "contracts_Admin";
        setIsAdmin(admin);
        const superAdmin = checkIsSuperAdmin(extUser);
        setIsSuperAdmin(superAdmin);
        if (!admin) {
          navigate("/dashboard/35KBoSgoAK");
          return;
        }
      }
      const res = await Parse.Cloud.run("getuserlistbyorg", {
        organizationId: extUser.OrganizationId.objectId
      });
      const _userRes = JSON.parse(JSON.stringify(res));
      setUserList(_userRes);

      try {
        const statsRes = await Parse.Cloud.run("getstoragestats");
        if (statsRes?.status === "success") {
          setStorageStats(statsRes);
        }
      } catch (statsErr) {
        console.warn("Could not load storage stats", statsErr);
      }
    } catch (err) {
      console.log("Err in fetch userlist", err);
      showAlert("danger", t("something-went-wrong-mssg"));
    } finally {
      setIsLoader(false);
    }
  }

  const handleModal = (modalName) => {
    setIsModal((obj) => ({ ...obj, [modalName]: !obj[modalName] }));
  };

  const paginateFront = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };
  const paginateBack = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const showAlert = (type, msg, duration = 3000) => {
    setIsAlert({ type: type, msg: msg });
    setTimeout(() => {
      setIsAlert({ type: "success", msg: "" });
    }, duration);
  };

  const handleUserData = (data) => {
    setUserList((prev) => [data, ...prev]);
  };

  const handleToggleBtn = (item) => {
    setIsActiveModal((obj) => ({
      ...obj,
      [item.objectId]: !obj[item.objectId]
    }));
  };

  const handleClose = () => {
    setIsActiveModal({});
  };

  const handleCloseModal = () => {
    setIsActModal({});
  };

  const handleToggleSubmit = withSessionValidation(async (item) => {
    try {
      const currentUser = JSON.parse(localStorage.getItem("Extand_Class"))?.[0];
      const isSuperAdmin = checkIsSuperAdmin(currentUser);
      if (!isSuperAdmin) {
        showAlert("danger", "Solo el Administrador Principal puede habilitar o inhabilitar usuarios.");
        return;
      }

      if (checkIsSuperAdmin(item)) {
        showAlert("danger", "No se puede inhabilitar al Administrador Principal.");
        return;
      }

      const newIsDisabled = !item?.IsDisabled;
      const res = await Parse.Cloud.run("toggleUserActive", {
        targetUserId: item.objectId,
        isDisabled: newIsDisabled
      });

      if (res?.status === "success") {
        setUserList((prev) =>
          prev.map((user) =>
            user.objectId === item.objectId
              ? { ...user, IsDisabled: newIsDisabled }
              : user
          )
        );
        setDetailUser((prev) =>
          prev && prev.objectId === item.objectId
            ? { ...prev, IsDisabled: newIsDisabled }
            : prev
        );
        showAlert(
          "success",
          newIsDisabled
            ? "Usuario inhabilitado con éxito."
            : "Usuario habilitado con éxito."
        );
      } else {
        showAlert("danger", res?.message || t("something-went-wrong-mssg"));
      }
    } catch (err) {
      console.error("Error toggling user active state:", err);
      showAlert("danger", err?.message || t("something-went-wrong-mssg"));
    } finally {
      handleClose();
    }
  });

  const handleActionBtn = (act, item) => {
    if (act.action === "edit") {
      setIsActModal({ ["edit_" + item.objectId]: true });
    } else if (act.action === "delete") {
      setIsActModal({ ["delete_" + item.objectId]: true });
    } else if (act.action === "resetpassword") {
      setIsActModal({ ["resetpassword_" + item.objectId]: true });
    }
  };

  const handleBtnVisibility = (act, item) => {
    if (checkIsSuperAdmin(item)) return false;
    if (item?.objectId === extClass?.[0]?.objectId) return false;
    return true;
  };

  const handleActiveToggleVisibility = (item) => {
    if (checkIsSuperAdmin(item)) return false;
    if (item?.objectId === extClass?.[0]?.objectId) return false;
    return true;
  };

  const submitPassword = withSessionValidation(async (userId, password) => {
    setIsLoader(true);
    setIsActModal({});
    try {
      const params = { userId, password };
      await Parse.Cloud.run("resetpassword", params);
      showAlert("success", t("password-has-been-reset"));
    } catch (err) {
      console.log("err while reset password", err);
      showAlert("danger", t(err.message), 2000);
    } finally {
      setIsLoader(false);
    }
  });

  const handleToggleUserRole = withSessionValidation(async (item) => {
    if (!isSuperAdmin) {
      showAlert("danger", "Solo el Administrador Principal puede otorgar o revocar privilegios.");
      return;
    }
    if (checkIsSuperAdmin(item)) {
      showAlert("danger", "No se pueden modificar los privilegios del Administrador Principal.");
      return;
    }
    const isCurrentAdmin = item?.UserRole === "contracts_Admin";
    const newRole = isCurrentAdmin ? "contracts_User" : "contracts_Admin";
    const confirmMsg = isCurrentAdmin
      ? `¿Está seguro de que desea revocar los privilegios de Administrador a ${item?.Name || item?.Email}?`
      : `¿Está seguro de que desea promover a ${item?.Name || item?.Email} como Administrador?`;

    if (!window.confirm(confirmMsg)) return;

    setIsLoader(true);
    try {
      await Parse.Cloud.run("updateuserrole", {
        targetUserId: item.objectId,
        newRole: newRole
      });
      setUserList((prev) =>
        prev.map((user) =>
          user.objectId === item.objectId ? { ...user, UserRole: newRole } : user
        )
      );
      showAlert(
        "success",
        newRole === "contracts_Admin"
          ? "Usuario promovido a Administrador con éxito."
          : "Privilegios de Administrador revocados con éxito."
      );
    } catch (err) {
      console.error("Error updating user role:", err);
      showAlert("danger", err?.message || "No se pudo actualizar el rol del usuario.");
    } finally {
      setIsLoader(false);
    }
  });

  const handleToggleAuthType = withSessionValidation(async (item, newIsLdapTarget) => {
    if (!isSuperAdmin) {
      showAlert("danger", "Solo el Administrador Principal puede cambiar el método de autenticación.");
      return;
    }
    if (checkIsSuperAdmin(item)) {
      showAlert("danger", "El Administrador Principal siempre utiliza autenticación local.");
      return;
    }

    const currentIsLdap = item?.isLdap === true || item?.UserId?.isLdap === true;
    const newIsLdap = typeof newIsLdapTarget === "boolean" ? newIsLdapTarget : !currentIsLdap;
    if (newIsLdap === currentIsLdap) return;

    const confirmMsg = newIsLdap
      ? `¿Cambiar el método de acceso de ${item?.Name || item?.Email} a Directorio Activo (LDAP)?`
      : `¿Cambiar el método de acceso de ${item?.Name || item?.Email} a Contraseña Local?`;

    if (!window.confirm(confirmMsg)) return;

    setIsLoader(true);
    try {
      const res = await Parse.Cloud.run("toggleUserAuthType", {
        targetUserId: item.objectId,
        isLdap: newIsLdap
      });

      if (res?.status === "success" || res?.success === true) {
        setUserList((prev) =>
          prev.map((user) =>
            user.objectId === item.objectId
              ? { ...user, isLdap: newIsLdap, UserId: { ...(user.UserId || {}), isLdap: newIsLdap } }
              : user
          )
        );
        setDetailUser((prev) =>
          prev && prev.objectId === item.objectId
            ? { ...prev, isLdap: newIsLdap, UserId: { ...(prev.UserId || {}), isLdap: newIsLdap } }
            : prev
        );
        showAlert(
          "success",
          newIsLdap
            ? "Método de acceso cambiado a Directorio Activo (LDAP)."
            : "Método de acceso cambiado a Contraseña Local."
        );
      } else {
        showAlert("danger", res?.message || t("something-went-wrong-mssg"));
      }
    } catch (err) {
      console.error("Error toggling auth type:", err);
      showAlert("danger", err?.message || t("something-went-wrong-mssg"));
    } finally {
      setIsLoader(false);
    }
  });

  const handleDeleteAccount = withSessionValidation(async (item) => {
    setDeleting(true);
    try {
      const headers = {
        "Content-Type": "application/json",
        "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
        "X-Parse-Session-Token": localStorage.getItem("accesstoken")
      };
      const res = await axios.post(
        localStorage.getItem("baseUrl") + "functions/deleteaccount",
        { extUserId: item?.objectId },
        { headers: headers }
      );
      if (res?.data?.result?.status === "success") {
        setDeleteUserRes(res?.data?.result?.status);
        setTimeout(() => {
          handleCloseModal();
          setUserList((prev) => prev.filter((user) => user.objectId !== item?.objectId));
          showAlert("success", t("user-deleted-successfully"));
          setDeleteUserRes("");
        }, 1000);
      }
    } catch (err) {
      console.log("err", err);
      showAlert("danger", t("something-went-wrong-mssg"));
    } finally {
      setDeleting(false);
    }
  });

  // Obtener nombre y cargo del superior directo
  const getSuperiorInfo = (reportsToId) => {
    if (!reportsToId) return null;
    const sup = userList.find(
      (u) =>
        u.objectId === reportsToId ||
        u.extUserId === reportsToId ||
        (u.Email && u.Email.toLowerCase() === reportsToId.toLowerCase())
    );
    if (!sup) return null;
    const name = formatDisplayName(sup?.Name, sup?.Email);
    const job = sup?.JobTitle ? ` (${sup.JobTitle})` : "";
    return `${name}${job}`;
  };

  return (
    <div className="relative">
      {isLoader ? (
        <div className="h-[100vh] flex justify-center items-center">
          <Loader />
        </div>
      ) : (
        <>
          {isAdmin ? (
            <div className="p-3 w-full bg-base-100 text-base-content op-card shadow-lg rounded-2xl border border-base-200">
              {isAlert.msg && (
                <Alert type={isAlert.type}>{isAlert.msg}</Alert>
              )}

              {/* Cabecera superior: Título, Buscador, Selector de Vista y Botón Crear */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-2 mb-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl md:text-2xl font-bold text-base-content">
                    {t("report-name.Users") || "Gestión de Usuarios"}
                  </h2>
                  <span className="badge badge-sm badge-ghost text-xs font-semibold">
                    {filteredUsers.length}
                  </span>
                  <Tooltip message={t("users-from-teams")} />
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                  {/* Buscador interactivo */}
                  <div className="relative w-full sm:w-64">
                    <i className="fa-light fa-magnifying-glass absolute left-3 top-2.5 text-base-content/50 text-xs"></i>
                    <input
                      type="text"
                      className="op-input op-input-bordered op-input-sm w-full pl-8 text-xs focus:outline-none rounded-lg"
                      placeholder="Buscar por nombre, cargo, nivel..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setCurrentPage(1);
                      }}
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm("")}
                        className="absolute right-2.5 top-2 text-base-content/50 hover:text-base-content text-xs"
                      >
                        <i className="fa-light fa-xmark"></i>
                      </button>
                    )}
                  </div>

                  {/* Selector de modo de vista: Tabla / Tarjetas */}
                  <div className="join border border-base-300 rounded-lg overflow-hidden bg-base-200/50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("table")}
                      className={`join-item op-btn op-btn-xs px-3 ${
                        viewMode === "table" ? "op-btn-primary !text-white" : "op-btn-ghost text-base-content/70"
                      }`}
                      title="Vista de Tabla Compacta"
                    >
                      <i className="fa-light fa-table-list mr-1"></i>
                      <span>Tabla</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("cards")}
                      className={`join-item op-btn op-btn-xs px-3 ${
                        viewMode === "cards" ? "op-btn-primary !text-white" : "op-btn-ghost text-base-content/70"
                      }`}
                      title="Vista de Tarjetas / Cartas"
                    >
                      <i className="fa-light fa-address-card mr-1"></i>
                      <span>Tarjetas</span>
                    </button>
                  </div>

                  {/* Botón Crear Usuario */}
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => handleModal("form")}
                      className="op-btn op-btn-primary op-btn-sm text-xs !text-white flex items-center gap-1.5 shadow-sm rounded-lg px-3.5"
                      title="Crear nuevo usuario"
                    >
                      <i className="fa-light fa-user-plus text-sm"></i>
                      <span>Nuevo Usuario</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Barra de Estadísticas de Almacenamiento */}
              {storageStats && (
                <div className="mx-2 mb-3 p-3 bg-base-200/50 rounded-xl border border-base-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <i className="fa-light fa-hard-drive text-primary text-base"></i>
                    <span className="font-semibold text-base-content/80">Almacenamiento:</span>
                    <span className="font-bold text-base-content">{storageStats.storageMB} MB</span>
                    <span className="text-base-content/50">({storageStats.totalFilesOnDisk} archivos)</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-success"></span>
                      <span className="text-base-content/70">Activos:</span>
                      <strong className="text-base-content">{storageStats.activeDocuments}</strong>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-error"></span>
                      <span className="text-base-content/70">Depurados:</span>
                      <strong className="text-base-content">{storageStats.purgedDocuments}</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* CONTENIDO PRINCIPAL: VISTA TABLA COMPACTA O VISTA TARJETAS */}
              {filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 bg-base-100 text-base-content/60 text-center">
                  <i className="fa-light fa-users-slash text-4xl mb-2 text-base-content/40"></i>
                  <span className="text-sm font-semibold">{t("no-data-available")}</span>
                  {searchTerm && (
                    <span className="text-xs text-base-content/50 mt-1">
                      No hay coincidencias para "{searchTerm}"
                    </span>
                  )}
                </div>
              ) : viewMode === "table" ? (
                /* 1. MODO TABLA COMPACTA (Solo datos imprescindibles, sin scroll horizontal) */
                <div className="w-full overflow-hidden rounded-xl border border-base-200 bg-base-100 shadow-xs">
                  <table className="op-table w-full text-xs">
                    <thead className="bg-base-200/60 text-base-content text-[12px] uppercase tracking-wider">
                      <tr className="border-b border-base-200">
                        <th className="py-3 px-4 w-14 text-center">Nº</th>
                        <th className="py-3 px-4">Colaborador</th>
                        <th className="py-3 px-4">Cargo</th>
                        <th className="py-3 px-4 text-center w-36">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-200">
                      {currentList.map((item, index) => {
                        const displayName = formatDisplayName(item?.Name, item?.Email);

                        return (
                          <tr
                            key={item.objectId || index}
                            className="hover:bg-primary/5 transition-colors cursor-pointer group"
                            onClick={(e) => {
                              // Evitar abrir modal si se interactuó con el botón de estado
                              if (e.target.closest("button, select, input, label, a")) return;
                              setDetailUser(item);
                            }}
                          >
                            {/* Nº */}
                            <td className="py-3.5 px-4 text-center font-bold text-base-content/50">
                              {startIndex + index + 1}
                            </td>

                            {/* Colaborador: Avatar + Nombre + Correo */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 border border-primary/20">
                                  {(displayName || "?").charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-base-content text-sm group-hover:text-primary transition-colors truncate">
                                    {displayName}
                                  </div>
                                  <div className="text-[11px] text-base-content/60 truncate">
                                    {item?.Email || "-"}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Cargo y Departamento */}
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-base-content text-xs truncate">
                                {item?.JobTitle || <span className="italic text-base-content/40">Sin cargo</span>}
                              </div>
                              {item?.Department && (
                                <div className="text-[11px] text-base-content/60 truncate">
                                  {item.Department}
                                </div>
                              )}
                            </td>

                            {/* Estado: Botón con indicador claro de Activo / Inactivo */}
                            <td className="py-3.5 px-4 text-center">
                              {handleActiveToggleVisibility(item) ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleBtn(item);
                                  }}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer shadow-xs ${
                                    item?.IsDisabled === true
                                      ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                  }`}
                                  title={
                                    item?.IsDisabled === true
                                      ? "Hacer clic para activar este usuario"
                                      : "Hacer clic para inhabilitar este usuario"
                                  }
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      item?.IsDisabled === true ? "bg-rose-500" : "bg-emerald-500"
                                    }`}
                                  ></span>
                                  <span>{item?.IsDisabled === true ? "Inactivo" : "Activo"}</span>
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                  <span>Activo</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* 2. MODO TARJETAS (Grid de Cartas limpias e intuitivas) */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {currentList.map((item, index) => {
                    const displayName = formatDisplayName(item?.Name, item?.Email);
                    const isSuper = checkIsSuperAdmin(item);

                    return (
                      <div
                        key={item.objectId || index}
                        onClick={() => setDetailUser(item)}
                        className="bg-base-100 rounded-2xl border border-base-200 p-4 shadow-xs hover:shadow-md hover:border-primary/40 transition-all flex flex-col justify-between cursor-pointer group"
                      >
                        <div>
                          {/* Cabecera de la tarjeta: Avatar + Nombre + Estado */}
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0 border border-primary/20">
                                {(displayName || "?").charAt(0).toUpperCase()}
                              </div>
                              <div className="overflow-hidden">
                                <h4 className="font-bold text-sm text-base-content truncate group-hover:text-primary transition-colors">
                                  {displayName}
                                </h4>
                                <p className="text-[11px] text-base-content/60 truncate">
                                  {item?.Email || "-"}
                                </p>
                              </div>
                            </div>

                            {/* Estado: Botón con indicador claro de Activo / Inactivo */}
                            {handleActiveToggleVisibility(item) ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleBtn(item);
                                }}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer shadow-xs shrink-0 ${
                                  item?.IsDisabled === true
                                    ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                }`}
                                title={
                                  item?.IsDisabled === true
                                    ? "Hacer clic para activar"
                                    : "Hacer clic para inhabilitar"
                                }
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    item?.IsDisabled === true ? "bg-rose-500" : "bg-emerald-500"
                                  }`}
                                ></span>
                                <span>{item?.IsDisabled === true ? "Inactivo" : "Activo"}</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                <span>Activo</span>
                              </span>
                            )}
                          </div>

                          {/* Cargo y Departamento */}
                          <div className="p-2.5 bg-base-200/50 rounded-xl text-xs space-y-1 mb-2">
                            <div className="flex justify-between items-center">
                              <span className="text-base-content/60">Cargo:</span>
                              <span className="font-semibold text-base-content truncate text-right">
                                {item?.JobTitle || <span className="italic text-base-content/40">Sin cargo</span>}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-base-content/60">Departamento:</span>
                              <span className="font-medium text-base-content truncate text-right">
                                {item?.Department || <span className="italic text-base-content/40">Sin departamento</span>}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Pie de la tarjeta: Botón Ver Ficha y Acciones */}
                        <div
                          className="flex items-center justify-between pt-2 border-t border-base-200 mt-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setDetailUser(item)}
                            className="op-btn op-btn-ghost op-btn-xs text-primary font-semibold flex items-center gap-1 px-1"
                          >
                            <i className="fa-light fa-address-card"></i>
                            <span>Ver ficha completa</span>
                          </button>

                          {isAdmin && isSuperAdmin && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setIsActModal({ ["edit_" + item.objectId]: true })}
                                className="op-btn op-btn-ghost op-btn-xs text-base-content/70 hover:text-primary"
                                title="Editar cargo y jerarquía"
                              >
                                <i className="fa-light fa-pen-to-square"></i>
                              </button>

                              {!isSuper && (
                                <button
                                  type="button"
                                  onClick={() => setIsActModal({ ["delete_" + item.objectId]: true })}
                                  className="op-btn op-btn-ghost op-btn-xs text-base-content/70 hover:text-error"
                                  title="Eliminar usuario"
                                >
                                  <i className="fa-light fa-trash"></i>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Paginación */}
              <div className="flex flex-row justify-between items-center text-xs font-medium pt-3 border-t border-base-200 mt-3 px-2">
                <span className="text-base-content/60">
                  Mostrando <strong>{filteredUsers.length > 0 ? indexOfFirstDoc + 1 : 0}</strong> -{" "}
                  <strong>{Math.min(indexOfLastDoc, filteredUsers.length)}</strong> de{" "}
                  <strong>{filteredUsers.length}</strong> usuarios
                </span>

                <div className="op-join flex items-center">
                  {totalPages > 1 && (
                    <button
                      onClick={paginateBack}
                      disabled={currentPage === 1}
                      className="op-join-item op-btn op-btn-xs"
                    >
                      {t("prev")}
                    </button>
                  )}
                  {pageNumbers.map((x, i) => (
                    <button
                      key={i}
                      onClick={() => typeof x === "number" && setCurrentPage(x)}
                      disabled={x === "..."}
                      className={`${
                        x === currentPage ? "op-btn-active op-btn-primary !text-white" : ""
                      } op-join-item op-btn op-btn-xs`}
                    >
                      {x}
                    </button>
                  ))}
                  {totalPages > 1 && (
                    <button
                      onClick={paginateFront}
                      disabled={currentPage === totalPages}
                      className="op-join-item op-btn op-btn-xs"
                    >
                      {t("next")}
                    </button>
                  )}
                </div>
              </div>

              {/* MODAL 1: FICHA COMPLETA DEL USUARIO (Al tocar cualquier nombre o tarjeta) */}
              {detailUser && (
                <ModalUi
                  isOpen={Boolean(detailUser)}
                  title="Ficha del Colaborador"
                  handleClose={() => setDetailUser(null)}
                  reduceWidth="md:min-w-[560px]"
                >
                  <div className="p-5 space-y-4">
                    {/* Cabecera de la ficha */}
                    <div className="flex items-center gap-4 p-4 bg-base-200/50 rounded-2xl border border-base-200">
                      <div className="w-14 h-14 rounded-full bg-primary text-white font-bold text-xl flex items-center justify-center shrink-0 shadow-md">
                        {(detailUser?.Name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-bold text-base md:text-lg text-base-content truncate">
                            {formatDisplayName(detailUser?.Name, detailUser?.Email)}
                          </h4>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                              LEVEL_CONFIG[detailUser?.HierarchyLevel]?.badgeClass || "bg-slate-100 text-slate-800"
                            }`}
                          >
                            <i className={`fa-light ${LEVEL_CONFIG[detailUser?.HierarchyLevel]?.icon || "fa-user"} mr-1`}></i>
                            {detailUser?.HierarchyLevel || "Especialista / Base"}
                          </span>
                        </div>
                        <p className="text-xs text-base-content/70 mt-0.5">
                          <strong>{detailUser?.JobTitle || "Sin cargo asignado"}</strong>
                          {detailUser?.Department ? ` • ${detailUser.Department}` : ""}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              detailUser?.UserRole === "contracts_Admin"
                                ? "bg-blue-100 text-blue-800 border border-blue-200"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {detailUser?.UserRole === "contracts_Admin" ? "Administrador" : "Usuario"}
                          </span>
                          {handleActiveToggleVisibility(detailUser) ? (
                            <button
                              type="button"
                              onClick={() => {
                                handleToggleBtn(detailUser);
                              }}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                                detailUser?.IsDisabled === true
                                  ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              }`}
                              title={
                                detailUser?.IsDisabled === true
                                  ? "Hacer clic para activar"
                                  : "Hacer clic para inhabilitar"
                              }
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  detailUser?.IsDisabled === true ? "bg-rose-500" : "bg-emerald-500"
                                }`}
                              ></span>
                              <span>{detailUser?.IsDisabled ? "Inactivo" : "Activo"}</span>
                              <i className="fa-light fa-arrows-rotate text-[10px] ml-0.5 opacity-60"></i>
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              <span>Activo</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Ficha en secciones estructuradas */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {/* 1. Contacto */}
                      <div className="p-3 bg-base-100 rounded-xl border border-base-200 space-y-2 shadow-xs">
                        <span className="font-bold text-base-content/60 text-[10px] uppercase tracking-wider block">
                          Datos de Contacto
                        </span>
                        <div>
                          <span className="text-base-content/60 block text-[11px]">Correo Electrónico:</span>
                          <span className="font-semibold text-base-content break-all">{detailUser?.Email || "-"}</span>
                        </div>
                        <div>
                          <span className="text-base-content/60 block text-[11px]">Teléfono:</span>
                          <span className="font-semibold text-base-content">
                            {detailUser?.Phone || <span className="italic text-base-content/40">No asignado</span>}
                          </span>
                        </div>
                      </div>

                      {/* 2. Jerarquía y Organigrama */}
                      <div className="p-3 bg-base-100 rounded-xl border border-base-200 space-y-2 shadow-xs">
                        <span className="font-bold text-base-content/60 text-[10px] uppercase tracking-wider block">
                          Ubicación en Organigrama
                        </span>
                        <div>
                          <span className="text-base-content/60 block text-[11px]">Nivel Jerárquico:</span>
                          <span className="font-semibold text-base-content">{detailUser?.HierarchyLevel || "Especialista / Base"}</span>
                        </div>
                        <div>
                          <span className="text-base-content/60 block text-[11px]">Superior directo / Reporta a:</span>
                          <span className="font-semibold text-base-content">
                            {getSuperiorInfo(detailUser?.ReportsTo) || (
                              <span className="italic text-base-content/50">Máxima Autoridad / Presidencia</span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* 3. Organización */}
                      <div className="p-3 bg-base-100 rounded-xl border border-base-200 space-y-2 shadow-xs sm:col-span-2">
                        <span className="font-bold text-base-content/60 text-[10px] uppercase tracking-wider block">
                          Seguridad y Método de Acceso
                        </span>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-base-content flex items-center gap-1.5">
                            <i
                              className={`fa-solid text-xs ${
                                detailUser?.isLdap === true || detailUser?.UserId?.isLdap === true
                                  ? "fa-network-wired text-purple-600"
                                  : "fa-key text-emerald-600"
                              }`}
                            ></i>
                            <span>
                              {detailUser?.isLdap === true || detailUser?.UserId?.isLdap === true
                                ? "Directorio Activo (LDAP)"
                                : "Contraseña Local"}
                            </span>
                          </span>

                          {isSuperAdmin && !checkIsSuperAdmin(detailUser) && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const isLdap = detailUser?.isLdap === true || detailUser?.UserId?.isLdap === true;
                                  handleToggleAuthType(detailUser, !isLdap);
                                  setDetailUser((prev) => ({ ...prev, isLdap: !isLdap }));
                                }}
                                className="op-btn op-btn-xs op-btn-outline"
                              >
                                Cambiar a {detailUser?.isLdap ? "Local" : "LDAP"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleToggleUserRole(detailUser);
                                  setDetailUser((prev) => ({
                                    ...prev,
                                    UserRole: prev.UserRole === "contracts_Admin" ? "contracts_User" : "contracts_Admin",
                                  }));
                                }}
                                className="op-btn op-btn-xs op-btn-outline"
                              >
                                {detailUser?.UserRole === "contracts_Admin" ? "Quitar Admin" : "Hacer Admin"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Botones de acción del Modal Ficha */}
                    <div className="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-base-200">
                      <div className="flex items-center gap-2">
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              const u = detailUser;
                              setDetailUser(null);
                              setIsActModal({ ["edit_" + u.objectId]: true });
                            }}
                            className="op-btn op-btn-primary op-btn-sm text-xs !text-white flex items-center gap-1.5 shadow-sm"
                          >
                            <i className="fa-light fa-pen-to-square"></i>
                            <span>Editar cargo y organigrama</span>
                          </button>
                        )}

                        {isSuperAdmin && !checkIsSuperAdmin(detailUser) && (
                          <button
                            type="button"
                            onClick={() => {
                              const u = detailUser;
                              setDetailUser(null);
                              setIsActModal({ ["resetpassword_" + u.objectId]: true });
                            }}
                            className="op-btn op-btn-outline op-btn-sm h-9 w-9 min-h-[36px] p-0 flex items-center justify-center rounded-lg hover:bg-base-200"
                            title="Restablecer contraseña"
                          >
                            <i className="fa-light fa-key text-sm"></i>
                          </button>
                        )}

                        {isSuperAdmin && !checkIsSuperAdmin(detailUser) && (
                          <button
                            type="button"
                            onClick={() => {
                              const u = detailUser;
                              setDetailUser(null);
                              setIsActModal({ ["delete_" + u.objectId]: true });
                            }}
                            className="op-btn op-btn-error op-btn-outline op-btn-sm text-xs flex items-center gap-1.5 rounded-lg"
                            title="Eliminar usuario"
                          >
                            <i className="fa-light fa-trash text-sm"></i>
                            <span>Eliminar</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setDetailUser(null)}
                        className="op-btn op-btn-ghost op-btn-sm text-xs px-4"
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                </ModalUi>
              )}

              {/* MODALES DE ACCIONES EXISTENTES (Activar, Reset Password, Editar, Eliminar, Crear) */}
              {currentList.map((item) => (
                <React.Fragment key={"modals_" + item.objectId}>
                  {isActiveModal[item.objectId] && (
                    <ModalUi
                      isOpen
                      title={t("user-status")}
                      handleClose={handleClose}
                    >
                      <div className="m-[20px]">
                        <div className="text-lg font-normal text-base-content">
                          {t("are-you-sure")}{" "}
                          {item?.IsDisabled ? t("activate") : t("deactivate")}{" "}
                          {t("this-user")}?
                        </div>
                        <hr className="bg-[#ccc] mt-4" />
                        <div className="flex items-center mt-3 gap-2 text-white">
                          <button
                            onClick={() => handleToggleSubmit(item)}
                            className="op-btn op-btn-primary"
                          >
                            {t("yes")}
                          </button>
                          <button
                            onClick={handleClose}
                            className="op-btn op-btn-secondary"
                          >
                            {t("no")}
                          </button>
                        </div>
                      </div>
                    </ModalUi>
                  )}

                  <DeleteUserModal
                    title={t("delete-account")}
                    deleting={deleting}
                    userEmail={item?.Email}
                    isOpen={Boolean(isActModal["delete_" + item.objectId])}
                    onConfirm={() => handleDeleteAccount(item)}
                    deleteRes={deleteUserRes}
                    handleClose={handleCloseModal}
                  />

                  <PasswordResetModal
                    isOpen={Boolean(isActModal["resetpassword_" + item.objectId])}
                    userId={item?.UserId?.objectId}
                    onClose={handleCloseModal}
                    onSubmit={submitPassword}
                    showAlert={showAlert}
                  />

                  <EditUserJobModal
                    isOpen={Boolean(isActModal["edit_" + item.objectId])}
                    user={item}
                    allUsers={userList}
                    handleClose={handleCloseModal}
                    showAlert={showAlert}
                    onSuccess={(userId, newJob, newDept, newLvl, newReportsTo) => {
                      setUserList((prev) =>
                        prev.map((u) =>
                          u.objectId === userId
                            ? {
                                ...u,
                                JobTitle: newJob,
                                Department: newDept,
                                HierarchyLevel: newLvl,
                                ReportsTo: newReportsTo,
                              }
                            : u
                        )
                      );
                    }}
                  />
                </React.Fragment>
              ))}

              {/* Modal Crear Usuario */}
              <ModalUi
                isOpen={isModal.form}
                title={formHeader}
                handleClose={() => handleModal("form")}
              >
                <AddUser
                  showAlert={showAlert}
                  handleUserData={handleUserData}
                  closePopup={() => handleModal("form")}
                  setFormHeader={setFormHeader}
                />
              </ModalUi>
            </div>
          ) : (
            <div className="flex items-center justify-center h-screen w-full bg-base-100 text-base-content rounded-box">
              <div className="text-center">
                <h1 className="text-[60px] lg:text-[120px] font-semibold">404</h1>
                <p className="text-[30px] lg:text-[50px]">{t("page-not-found")}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UserList;
