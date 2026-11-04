import { useEffect, useState } from "react";
import Parse from "parse";
import Loader from "../primitives/Loader";
import {
  copytoData,
  usertimezone
} from "../constant/Utils";
import {
  emailRegex,
  HIERARCHY_LEVELS
} from "../constant/const";
import {
  useTranslation
} from "react-i18next";
import { withSessionValidation } from "../utils";
import SuperiorSearchSelect from "../primitives/SuperiorSearchSelect";

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

function generatePassword(length) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const AddUser = (props) => {
  const { t } = useTranslation();
  const [formdata, setFormdata] = useState({
    name: "",
    jobTitle: "",
    department: "",
    hierarchyLevel: "Especialista / Base",
    reportsTo: "",
    phone: "",
    email: "",
    team: "",
    password: "",
    role: "User",
    isLdap: true
  });
  const [isFormLoader, setIsFormLoader] = useState(false);
  const [teamList, setTeamList] = useState([]);
  const [superiorsList, setSuperiorsList] = useState([]);
  const roles = [
    { label: "Usuario", value: "User" },
    { label: "Administrador", value: "Admin" }
  ];
  useEffect(() => {
    getTeamList();
    // eslint-disable-next-line
  }, []);

  const getTeamList = async () => {
    setFormdata((prev) => ({ ...prev, password: generatePassword(12) }));
    try {
      const localUser = JSON.parse(localStorage.getItem("Extand_Class"))?.[0];
      const orgId = localUser?.OrganizationId?.objectId;
      if (orgId) {
        const usersRes = await Parse.Cloud.run("getuserlistbyorg", { organizationId: orgId });
        if (usersRes && usersRes.length > 0) {
          const filtered = usersRes.filter(
            (u) => (u.Email || "").toLowerCase().trim() !== "admin@brascuba.cu"
          );
          setSuperiorsList(filtered);
        }
      }
    } catch (e) {
      console.log("Error loading superiors list:", e);
    }

    const teamRes = await Parse.Cloud.run("getteams", { active: true });
    if (teamRes.length > 0) {
      const _teamRes = JSON.parse(JSON.stringify(teamRes));
      setTeamList(_teamRes);
      const allUserId =
        _teamRes.find((x) => x.Name === "All Users")?.objectId || "";
      setFormdata((prev) => ({ ...prev, team: allUserId }));
    }
  };
  const checkUserExist = async () => {
    try {
      const res = await Parse.Cloud.run("getUserDetails", {
        email: formdata.email
      });
      if (res) {
        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.log("err", err);
    }
  };
  // Define a function to handle form submission
  const handleSubmit = withSessionValidation(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!formdata.name || !formdata.name.trim()) {
      alert("El nombre es obligatorio.");
      return;
    }
    if (!formdata.jobTitle || !formdata.jobTitle.trim()) {
      alert("El cargo es obligatorio y no puede estar vacío.");
      return;
    }
    if (!formdata.department || !formdata.department.trim()) {
      alert("El departamento es obligatorio y no puede estar vacío.");
      return;
    }
    if (!emailRegex.test(formdata.email)) {
      alert(t("valid-email-alert"));
    } else {
      const localUser = JSON.parse(localStorage.getItem("Extand_Class"))?.[0];
      setIsFormLoader(true);
      const res = await checkUserExist();
      if (res) {
        props.showAlert("danger", t("user-already-exist"));
        setIsFormLoader(false);
      } else {
        if (localStorage.getItem("TenantId")) {
          const timezone = usertimezone;
          try {
            const params = {
              name: formdata.name,
              jobTitle: formdata.jobTitle,
              department: formdata.department,
              hierarchyLevel: formdata.hierarchyLevel,
              reportsTo: formdata.reportsTo,
              email: formdata.email,
              phone: formdata.phone,
              password: formdata.password,
              role: formdata.role || "User",
              team: formdata.team,
              isLdap: formdata.isLdap,
              timezone: timezone,
              tenantId: localStorage.getItem("TenantId"),
              organization: {
                objectId: localUser?.OrganizationId?.objectId,
                company: localUser?.Company
              },
            };
            const res = await Parse.Cloud.run("adduser", params);
            const parseData = JSON.parse(JSON.stringify(res));
            if (props.closePopup) {
              props.closePopup();
            }
            if (props.handleUserData) {
              if (formdata?.team) {
                const team = teamList.find((x) => x.objectId === formdata.team);
                parseData.TeamIds = parseData.TeamIds.map((y) =>
                  y.objectId === team.objectId ? team : y
                );
              }
              props.handleUserData(parseData);
            }
            setIsFormLoader(false);
            setFormdata({
              name: "",
              jobTitle: "",
              department: "",
              hierarchyLevel: "Especialista / Base",
              reportsTo: "",
              email: "",
              phone: "",
              team: "",
              role: "User",
              isLdap: true,
              password: ""
            });
            props.showAlert("success", t("user-created-successfully"));
          } catch (err) {
            console.log("err", err);
            setIsFormLoader(false);
            props.showAlert("danger", t("something-went-wrong-mssg"));
          }
        } else {
          props.showAlert("danger", t("something-went-wrong-mssg"));
        }
      }
    }
  });

  // Define a function to handle the "add yourself" checkbox
  const handleReset = () => {
    setFormdata({
      name: "",
      jobTitle: "",
      department: "",
      email: "",
      phone: "",
      team: "",
      role: "User",
      isLdap: true,
      password: ""
    });
    if (props.closePopup) {
      props.closePopup();
    }
  };
  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setFormdata((prev) => ({ ...prev, [name]: value }));
  };

  const copytoclipboard = (text) => {
    copytoData(text);
    props.showAlert("success", t("copied"));
  };
  return (
    <div className="shadow-md rounded-box my-[1px] p-3 bg-base-100 relative">
      {isFormLoader && (
        <div className="absolute w-full h-full inset-0 flex justify-center items-center bg-base-content/30 z-50">
          <Loader />
        </div>
      )}
              <div className="w-full mx-auto">
                    <form onSubmit={handleSubmit}>
                      <div className="mb-3">
                        <label
                          htmlFor="name"
                          className="block text-xs font-semibold"
                        >
                          {t("name")}
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={formdata.name}
                          onChange={(e) => handleChange(e)}
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          required
                          className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                          placeholder={t("enter-name")}
                        />
                      </div>
                      <div className="mb-3">
                        <label
                          htmlFor="jobTitle"
                          className="block text-xs font-semibold"
                        >
                          Cargo / Puesto
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <input
                          type="text"
                          name="jobTitle"
                          value={formdata.jobTitle}
                          onChange={(e) => handleChange(e)}
                          required
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                          placeholder="ej: Especialista de Sistemas"
                        />
                      </div>
                      <div className="mb-3">
                        <label
                          htmlFor="department"
                          className="block text-xs font-semibold"
                        >
                          Departamento
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <input
                          type="text"
                          name="department"
                          value={formdata.department}
                          onChange={(e) => handleChange(e)}
                          required
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                          placeholder="ej: Recursos Humanos, TI, etc."
                        />
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs font-semibold">
                          Nivel Jerárquico en la Empresa
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <select
                          name="hierarchyLevel"
                          value={formdata.hierarchyLevel}
                          onChange={(e) => handleChange(e)}
                          className="op-select op-select-bordered op-select-sm focus:outline-none hover:border-base-content w-full text-xs"
                        >
                          {HIERARCHY_LEVELS.map((lvl) => (
                            <option key={lvl.value} value={lvl.value}>
                              {lvl.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mb-3">
                        <SuperiorSearchSelect
                          value={formdata.reportsTo}
                          onChange={(val) => setFormdata((prev) => ({ ...prev, reportsTo: val }))}
                          superiorsList={superiorsList}
                          disabled={isFormLoader}
                          hint="Ubicación dentro del organigrama empresarial."
                        />
                      </div>
                      <div className="mb-3">
                        <label
                          htmlFor="email"
                          className="block text-xs font-semibold"
                        >
                          {t("email")}
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <input
                          type="email"
                          name="email"
                          value={formdata.email}
                          onChange={(e) => handleChange(e)}
                          required
                          onInvalid={(e) =>
                            e.target.setCustomValidity(t("input-required"))
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                          className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                          placeholder={t("enter-email")}
                        />
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs font-semibold">
                          {t("password")}
                        </label>
                        <div className="flex justify-between items-center op-input op-input-bordered op-input-sm text-base-content w-full h-full text-[13px]">
                          <div className="break-all">{formdata?.password}</div>
                          <i
                            onClick={() => copytoclipboard(formdata?.password)}
                            className="fa-light fa-copy rounded-full hover:bg-base-300 p-[8px] cursor-pointer "
                          ></i>
                        </div>
                        <div className="text-[12px] ml-2 mb-0 text-[red] select-none">
                          {t("password-generated")}
                        </div>
                      </div>
                      <div className="mb-3">
                        <label
                          htmlFor="phone"
                          className="block text-xs font-semibold"
                        >
                          {t("phone")}
                        </label>
                        <input
                          type="text"
                          name="phone"
                          placeholder={t("phone-optional")}
                          value={formdata.phone}
                          onChange={(e) => handleChange(e)}
                          className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                        />
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs font-semibold mb-1">
                          Método de Autenticación
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <div className="flex items-center gap-4 text-xs mt-1 p-2 rounded bg-base-200/50">
                          <label className="flex items-center gap-2 cursor-pointer font-medium">
                            <input
                              type="radio"
                              name="isLdap"
                              className="op-radio op-radio-sm op-radio-primary"
                              checked={formdata.isLdap === true}
                              onChange={() => setFormdata((prev) => ({ ...prev, isLdap: true }))}
                            />
                            <span>LDAP (Directorio Activo)</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer font-medium">
                            <input
                              type="radio"
                              name="isLdap"
                              className="op-radio op-radio-sm op-radio-primary"
                              checked={formdata.isLdap === false}
                              onChange={() => setFormdata((prev) => ({ ...prev, isLdap: false }))}
                            />
                            <span>Contraseña Local</span>
                          </label>
                        </div>
                      </div>
                      <div className="mb-3">
                        <label
                          htmlFor="role"
                          className="block text-xs font-semibold"
                        >
                          {t("Role")}
                          <span className="text-[red] text-[13px]"> *</span>
                        </label>
                        <select
                          value={formdata.role}
                          onChange={(e) => handleChange(e)}
                          name="role"
                          className="op-select op-select-bordered op-select-sm focus:outline-none hover:border-base-content w-full text-xs cursor-pointer font-medium"
                          required
                        >
                          {roles.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center mt-3 gap-2 text-white">
                        <button type="submit" className="op-btn op-btn-primary">
                          {t("submit")}
                        </button>
                        <div
                          type="button"
                          onClick={() => handleReset()}
                          className="op-btn op-btn-secondary"
                        >
                          {t("cancel")}
                        </div>
                      </div>
                    </form>
              </div>
    </div>
  );
};

export default AddUser;
