import React, { useState, useEffect } from "react";
import { Navigate } from "react-router";
import Parse from "parse";
import { SaveFileSize } from "../constant/saveFileSize";
import dp from "../assets/images/dp.png";
import { compressImage, sanitizeFileName } from "../utils";
import axios from "axios";
import { getSecureUrl } from "../constant/Utils";
import Loader from "../primitives/Loader";
import ModalUi from "../primitives/ModalUi";
import { useTranslation } from "react-i18next";

export function formatDisplayName(raw, email) {
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

function UserProfile() {
  const { t } = useTranslation();
  const [parseBaseUrl] = useState(localStorage.getItem("baseUrl"));
  const [parseAppId] = useState(localStorage.getItem("parseAppId"));
  const [Phone, setPhone] = useState("");
  const [Image, setImage] = useState("");
  const [isLoader, setIsLoader] = useState(true);
  const [percentage, setPercentage] = useState(0);
  const [userDetails, setUserDetails] = useState(null);

  // Estados para la ventana emergente de edición
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editImage, setEditImage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getUserDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getUserDetail = async () => {
    try {
      const res = await Parse.Cloud.run("getUserDetails");
      if (res) {
        const data = JSON.parse(JSON.stringify(res));
        setUserDetails(data);
        const currentPhone = data?.Phone || data?.UserId?.phone || "";
        const currentImg = data?.UserId?.ProfilePic || localStorage.getItem("profileImg") || "";
        setPhone(currentPhone);
        setImage(currentImg);

        // Actualizar localStorage si el nombre tiene formato con puntos
        const formattedName = formatDisplayName(data?.Name, data?.Email);
        if (formattedName) {
          localStorage.setItem("username", formattedName);
        }

        const extArr = JSON.stringify([data]);
        localStorage.setItem("Extand_Class", extArr);
      }
    } catch (err) {
      console.log("Error loading user details:", err);
      const extendUser = localStorage.getItem("Extand_Class") && JSON.parse(localStorage.getItem("Extand_Class"));
      if (extendUser && extendUser[0]) {
        setUserDetails(extendUser[0]);
        setPhone(extendUser[0]?.Phone || "");
        setImage(extendUser[0]?.UserId?.ProfilePic || localStorage.getItem("profileImg") || "");
      }
    } finally {
      setIsLoader(false);
    }
  };

  const handleOpenEditModal = () => {
    setEditPhone(Phone || userDetails?.Phone || userDetails?.UserId?.phone || "");
    setEditImage(Image || userDetails?.UserId?.ProfilePic || localStorage.getItem("profileImg") || "");
    setPercentage(0);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    if (isSaving) return;
    setIsEditModalOpen(false);
    setPercentage(0);
  };

  const fileUpload = async (event) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

      if (!allowedTypes.includes(file.type)) {
        alert("Formato no válido. Solo se permiten imágenes JPEG, PNG o WebP.");
        event.target.value = "";
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        alert("La imagen excede el límite de tamaño permitido (máximo 2 MB).");
        event.target.value = "";
        return;
      }

      const compressedfile = await compressImage(
        file,
        { width: 300, height: 300 },
        "file"
      );
      await handleFileUpload(compressedfile);
    }
  };

  const handleFileUpload = async (file) => {
    const size = file.size;
    const name = sanitizeFileName(file.name);
    const parseFile = new Parse.File(name, file);

    try {
      const response = await parseFile.save({
        progress: (progressValue, loaded, total) => {
          if (progressValue !== null) {
            setPercentage(Math.round((loaded * 100) / total));
          }
        }
      });

      if (response?.url()) {
        const fileRes = await getSecureUrl(response?.url());
        if (fileRes?.url) {
          setEditImage(fileRes?.url);
          setPercentage(0);
          const tenantId = localStorage.getItem("TenantId");
          const userId = userDetails?.UserId?.objectId || userDetails?.UserId?.id;
          SaveFileSize(size, fileRes?.url, tenantId, userId);
        }
      }
    } catch (error) {
      console.error("Error subiendo foto de perfil:", error);
      alert("Error al subir la imagen.");
    }
  };

  const handleSaveModal = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setIsSaving(true);
    try {
      const currentUser = Parse.User.current();
      if (!currentUser) {
        throw new Error("Sesión no válida");
      }

      const trimmedPhone = (editPhone || "").trim();

      // Guardar en _User (ProfilePic y phone)
      if (editImage) {
        currentUser.set("ProfilePic", editImage);
      }
      currentUser.set("phone", trimmedPhone);
      await currentUser.save();

      if (editImage) {
        localStorage.setItem("profileImg", editImage);
        setImage(editImage);
      }
      setPhone(trimmedPhone);

      let userInfo = localStorage.getItem("UserInformation");
      if (userInfo) {
        try {
          const parsed = JSON.parse(userInfo);
          parsed.phone = trimmedPhone;
          if (editImage) parsed.ProfilePic = editImage;
          localStorage.setItem("UserInformation", JSON.stringify(parsed));
        } catch (_) {}
      }

      // Actualizar también en contracts_Users (solo Phone)
      const extUserId = userDetails?.objectId;
      if (extUserId) {
        await axios.put(
          parseBaseUrl + "classes/contracts_Users/" + extUserId,
          { Phone: trimmedPhone },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Parse-Application-Id": parseAppId,
              "X-Parse-Session-Token": localStorage.getItem("accesstoken")
            }
          }
        );
      }

      alert("Perfil actualizado exitosamente.");
      setIsEditModalOpen(false);
      await getUserDetail();
    } catch (error) {
      console.error("Error al actualizar perfil:", error);
      alert(error?.message || t("something-went-wrong-mssg"));
    } finally {
      setIsSaving(false);
    }
  };

  if (!localStorage.getItem("accesstoken")) {
    return <Navigate to="/" />;
  }

  const roleName =
    userDetails?.UserRole === "contracts_Admin"
      ? "Administrador"
      : userDetails?.UserRole === "contracts_OrgAdmin"
      ? "Administrador de Organización"
      : userDetails?.UserRole === "contracts_User"
      ? "Usuario"
      : localStorage.getItem("_user_role") || "Usuario";

  const isLdap = userDetails?.isLdap === true || userDetails?.UserId?.isLdap === true;
  const displayName = formatDisplayName(userDetails?.Name || localStorage.getItem("username"), userDetails?.Email);

  return (
    <React.Fragment>
      {isLoader ? (
        <div className="h-[100vh] flex justify-center items-center">
          <Loader />
        </div>
      ) : (
        <div className="flex justify-center items-center w-full relative py-8 px-4">
          <div className="bg-base-100 text-base-content flex flex-col justify-center shadow-lg rounded-2xl w-full max-w-[480px] p-6 border border-base-200">
            {/* Foto de Perfil y Nombre */}
            <div className="flex flex-col justify-center items-center mb-4">
              <div className="w-[140px] h-[140px] overflow-hidden rounded-full shadow-md border-3 border-primary/30 relative bg-base-200">
                <img
                  className="object-cover w-full h-full"
                  src={Image || dp}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = dp;
                  }}
                  alt="Avatar"
                />
              </div>

              <div className="text-xl font-bold text-base-content mt-3 text-center">
                {displayName || "-"}
              </div>
              <div className="badge badge-primary badge-outline text-xs mt-1 font-medium">
                {roleName}
              </div>
            </div>

            {/* Ficha de datos del usuario (Solo Lectura) */}
            <div className="w-full divide-y divide-base-200 text-xs border-y border-base-200 my-2">
              {/* Nombre */}
              <div className="flex justify-between items-center py-2.5">
                <span className="font-semibold text-base-content/70">Nombre completo:</span>
                <span className="font-medium text-base-content text-right">
                  {displayName || "-"}
                </span>
              </div>

              {/* Correo Electrónico */}
              <div className="flex justify-between items-center py-2.5">
                <span className="font-semibold text-base-content/70">Correo electrónico:</span>
                <span className="font-medium text-base-content text-right break-all">
                  {userDetails?.Email || userDetails?.UserId?.email || "-"}
                </span>
              </div>

              {/* Teléfono */}
              <div className="flex justify-between items-center py-2.5">
                <span className="font-semibold text-base-content/70">Teléfono:</span>
                <span className="font-medium text-base-content text-right">
                  {Phone || <span className="italic text-base-content/50">No asignado</span>}
                </span>
              </div>

              {/* Cargo / Puesto */}
              <div className="flex justify-between items-center py-2.5">
                <span className="font-semibold text-base-content/70">Cargo / Puesto:</span>
                <span className="font-medium text-base-content text-right">
                  {userDetails?.JobTitle || <span className="italic text-base-content/50">No asignado</span>}
                </span>
              </div>

              {/* Departamento */}
              <div className="flex justify-between items-center py-2.5">
                <span className="font-semibold text-base-content/70">Departamento:</span>
                <span className="font-medium text-base-content text-right">
                  {userDetails?.Department || <span className="italic text-base-content/50">No asignado</span>}
                </span>
              </div>

              {/* Empresa */}
              {userDetails?.Company && (
                <div className="flex justify-between items-center py-2.5">
                  <span className="font-semibold text-base-content/70">Empresa:</span>
                  <span className="font-medium text-base-content text-right">
                    {userDetails?.Company}
                  </span>
                </div>
              )}

              {/* Tipo de Autenticación */}
              <div className="flex justify-between items-center py-2.5">
                <span className="font-semibold text-base-content/70">Acceso:</span>
                <span className="font-medium text-right flex items-center gap-1.5">
                  <i
                    className={`fa-solid text-[11px] ${
                      isLdap ? "fa-network-wired text-purple-600" : "fa-key text-emerald-600"
                    }`}
                  ></i>
                  <span>{isLdap ? "Directorio Activo (LDAP)" : "Contraseña Local"}</span>
                </span>
              </div>
            </div>

            {/* Botón para abrir la ventana emergente */}
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={handleOpenEditModal}
                className="op-btn op-btn-primary op-btn-sm text-xs !text-white px-6 flex items-center gap-2 shadow-sm rounded-lg"
              >
                <i className="fa-light fa-pen"></i>
                <span>Editar teléfono o foto</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ventana emergente (Modal) para editar Teléfono y Foto de Perfil */}
      <ModalUi
        isOpen={isEditModalOpen}
        title="Editar Foto y Teléfono"
        handleClose={handleCloseEditModal}
      >
        <div className="p-5 relative">
          {isSaving && (
            <div className="absolute inset-0 bg-base-100/80 z-50 flex flex-col justify-center items-center rounded-box">
              <Loader />
              <span className="text-xs mt-2 text-base-content font-medium">Guardando cambios...</span>
            </div>
          )}

          <div className="bg-base-200/60 p-3 rounded-lg text-xs text-base-content/80 mb-4 border border-base-200">
            <i className="fa-light fa-circle-info mr-1.5 text-primary"></i>
            Solo puedes modificar tu foto de perfil y tu número de teléfono. Los demás datos de tu cuenta solo pueden ser administrados por el Administrador General.
          </div>

          <form onSubmit={handleSaveModal} className="space-y-4">
            {/* Foto de Perfil con subida */}
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary/40 shadow-sm relative bg-base-200">
                <img
                  src={editImage || dp}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = dp;
                  }}
                  alt="Vista previa de perfil"
                  className="w-full h-full object-cover"
                />
              </div>

              <label className="op-btn op-btn-outline op-btn-primary op-btn-xs text-xs cursor-pointer flex items-center gap-1.5 mt-1">
                <i className="fa-light fa-camera"></i>
                <span>Seleccionar nueva foto</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={fileUpload}
                  disabled={isSaving}
                />
              </label>
              <span className="text-[10px] text-base-content/60">
                Formatos permitidos: PNG, JPEG o WebP (máximo 2 MB)
              </span>

              {percentage !== 0 && (
                <div className="flex items-center gap-x-2 mt-1 w-full max-w-[200px]">
                  <div className="h-1.5 rounded-full w-full bg-base-300 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-all"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                  <span className="text-[10px] text-base-content font-medium">{percentage}%</span>
                </div>
              )}
            </div>

            {/* Campo de Teléfono */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-base-content">
                Número de Teléfono
              </label>
              <input
                type="text"
                disabled={isSaving}
                className="op-input op-input-bordered op-input-sm w-full text-xs"
                placeholder="ej: +53 52345678"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
              <span className="text-[10px] text-base-content/50 mt-0.5 block">
                Opcional. Se mostrará en los datos de contacto.
              </span>
            </div>

            {/* Botones de acción del Modal */}
            <div className="flex justify-end gap-2 pt-3 border-t border-base-200">
              <button
                type="button"
                onClick={handleCloseEditModal}
                disabled={isSaving}
                className="op-btn op-btn-ghost op-btn-sm text-xs px-4"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="op-btn op-btn-primary op-btn-sm text-xs !text-white px-5 flex items-center gap-1.5"
              >
                <i className="fa-light fa-check"></i>
                <span>{t("save", { defaultValue: "Guardar cambios" })}</span>
              </button>
            </div>
          </form>
        </div>
      </ModalUi>
    </React.Fragment>
  );
}

export default UserProfile;
