import { useEffect, useState } from "react";
import Parse from "parse";
import { useDispatch } from "react-redux";
import axios from "axios";
import { NavLink, useNavigate, useLocation } from "react-router";
import login_img from "../assets/images/brascuba_login.jpg";
import { useWindowSize } from "../hook/useWindowSize";
import ModalUi from "../primitives/ModalUi";
import {
  emailRegex,
} from "../constant/const";
import Alert from "../primitives/Alert";
import { appInfo } from "../constant/appinfo";
import { fetchAppInfo } from "../redux/reducers/infoReducer";
import { showTenant } from "../redux/reducers/ShowTenant";
import {
  getAppLogo,
  saveLanguageInLocal,
  usertimezone
} from "../constant/Utils";
import Loader from "../primitives/Loader";
import { useTranslation } from "react-i18next";
import { startUserSession, validateSessionOnStartup, endUserSession } from "../utils/sessionManager";

function Login() {
  const appName =
    "OpenSign™";
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { width } = useWindowSize();
  const [state, setState] = useState({
    email: "",
    password: "",
    alertType: "success",
    alertMsg: "",
    passwordVisible: false,
    loading: false,
    thirdpartyLoader: false,
    rememberMe: false,
  });
  const [userDetails, setUserDetails] = useState({
    Company: "",
    Destination: ""
  });
  const [isModal, setIsModal] = useState(false);
  const [image, setImage] = useState();
  const [errMsg, setErrMsg] = useState();
  useEffect(() => {
    i18n.changeLanguage("es");
    localStorage.setItem("i18nextLng", "es");
    const queryParams = new URLSearchParams(window.location.search);
    const emailParam = queryParams.get("email");
    const requiresAuth = queryParams.get("requiresAuth");
    const remembered = localStorage.getItem("remembered_user");
    if (emailParam) {
      setState((prev) => ({ ...prev, email: emailParam }));
    } else if (remembered) {
      setState((prev) => ({ ...prev, email: remembered, rememberMe: true }));
    }
    if (requiresAuth === "true" || sessionStorage.getItem("redirectAfterLogin")) {
      showToast("info", "Por su seguridad, inicie sesión con su cuenta corporativa para acceder al documento.");
    }
    handleUserExist();
    // eslint-disable-next-line
  }, []);

  const handleUserExist = async () => {
    checkUserExt();
  };


  const setLocalVar = (user) => {
    localStorage.setItem("accesstoken", user.sessionToken);
    startUserSession();
    localStorage.setItem("UserInformation", JSON.stringify(user));
    localStorage.setItem("userEmail", user.email);
    if (user.ProfilePic) {
      localStorage.setItem("profileImg", user.ProfilePic);
    } else {
      localStorage.setItem("profileImg", "");
    }
  };

  const showToast = (type, msg) => {
    setState((prev) => ({ ...prev, loading: false, alertType: type, alertMsg: msg }));
    if (type !== "danger") {
      setTimeout(() => setState((prev) => ({ ...prev, alertMsg: "" })), 6000);
    }
  };

  const checkUserExt = async () => {
    const app = await getAppLogo();
    if (app?.error === "invalid_json") {
      setErrMsg(t("server-down", { appName: appName }));
    } else if (
      app?.user === "not_exist"
    ) {
      navigate("/addadmin");
    }
    if (app?.logo) {
      setImage(app?.logo);
    } else {
      setImage(appInfo?.applogo || undefined);
    }
    dispatch(fetchAppInfo());

    // Validar si la sesión sigue activa (inactividad < 30min y navegador no cerrado)
    const isSessionValid = validateSessionOnStartup();
    if (isSessionValid && localStorage.getItem("accesstoken")) {
      setState((prev) => ({ ...prev, loading: true }));
      GetLoginData();
    }
  };
  const handleChange = (event) => {
    let { name, value } = event.target;
    if (name === "email") {
      value = value?.toLowerCase()?.replace(/\s/g, "");
    }
    setState((prev) => ({ ...prev, [name]: value, alertMsg: "" }));
  };

  const handleLogin = async (
  ) => {
    const email = state?.email
    const password = state?.password

    if (!email || !password) {
      return;
    }
    localStorage.removeItem("accesstoken");
    try {
      setState({ ...state, loading: true });
      localStorage.setItem("appLogo", appInfo.applogo);
      const _user = await Parse.Cloud.run("loginuser", { email, password });
      if (!_user) {
        setState({ ...state, loading: false });
        return;
      }
      if (state.rememberMe) {
        localStorage.setItem("remembered_user", email);
      } else {
        localStorage.removeItem("remembered_user");
      }
      // Get extended user data (including 2FA status) using cloud function
      try {
        await Parse.User.become(_user.sessionToken);
        setLocalVar(_user);
        await continueLoginFlow();
      } catch (error) {
        console.error("Error checking 2FA status:", error);
        showToast("danger", t("something-went-wrong-mssg"));
      }
    } catch (error) {
      console.error("Error while logging in user", error);
      if (error?.code === 1001) {
        showToast("danger", t("action-prohibited"));
      } else if (error?.message) {
        showToast("danger", error.message);
      } else {
        showToast("danger", "Usuario o contraseña incorrectos. Por favor, verifique sus credenciales.");
      }
    }
  };
  const handleLoginBtn = async (event) => {
    event.preventDefault();
    if (!state.email || !state.email.trim()) {
      alert("Por favor ingrese su usuario o correo.");
      return;
    }
    await handleLogin();
  };

  const setThirdpartyLoader = (value) => {
    setState({ ...state, thirdpartyLoader: value });
  };

  const thirdpartyLoginfn = async (sessionToken) => {
    const baseUrl = localStorage.getItem("baseUrl");
    const parseAppId = localStorage.getItem("parseAppId");
    const res = await axios.get(baseUrl + "users/me", {
      headers: {
        "X-Parse-Session-Token": sessionToken,
        "X-Parse-Application-Id": parseAppId
      }
    });
    await Parse.User.become(sessionToken).then(() => {
      window.localStorage.setItem("accesstoken", sessionToken);
    });
    if (res.data) {
      let _user = res.data;
      setLocalVar(_user);
      // Check extended class user role and tenentId
      try {
        const userSettings = appInfo.settings;
        const extUser = await Parse.Cloud.run("getUserDetails");
        if (extUser) {
          const IsDisabled = extUser?.get("IsDisabled") || false;
          if (!IsDisabled) {
            const userRole = extUser?.get("UserRole");
            const menu =
              userRole && userSettings.find((menu) => menu.role === userRole);
            if (menu) {
              const _currentRole = userRole;
              const redirectUrl =
                location?.state?.from || `/${menu.pageType}/${menu.pageId}`;
              const _role = _currentRole.replace("contracts_", "");
              const extInfo = JSON.parse(JSON.stringify(extUser));
              localStorage.setItem("_user_role", _role);
              localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
              localStorage.setItem("userEmail", extInfo?.Email);
              localStorage.setItem("username", extInfo?.Name);
              if (extInfo?.TenantId) {
                const tenant = {
                  Id: extInfo?.TenantId?.objectId || "",
                  Name: extInfo?.TenantId?.TenantName || ""
                };
                localStorage.setItem("TenantId", tenant?.Id);
                dispatch(showTenant(tenant?.Name));
                localStorage.setItem("TenantName", tenant?.Name);
              }
              localStorage.setItem("PageLanding", menu.pageId);
              localStorage.setItem("defaultmenuid", menu.menuId);
              localStorage.setItem("pageType", menu.pageType);
                navigate(redirectUrl);
            } else {
              showToast("danger", t("role-not-found"));
              logOutUser();
            }
          } else {
            showToast("danger", t("do-not-access-contact-admin"));
            logOutUser();
          }
        } else {
          showToast("danger", t("user-not-found"));
          logOutUser();
        }
      } catch (error) {
        console.error("err in fetching extUser", error);
        showToast("danger", `${error?.message || t("something-went-wrong-mssg")}`);
        logOutUser();
      } finally {
        setThirdpartyLoader(false);
      }
    }
  };

  const GetLoginData = async () => {
    setState({ ...state, loading: true });
    try {
      const user = await Parse.User.become(localStorage.getItem("accesstoken"));
      const _user = user.toJSON();
      setLocalVar(_user);
      const userSettings = appInfo.settings;
      const extUser = await Parse.Cloud.run("getUserDetails");
      if (extUser) {
        const IsDisabled = extUser?.get("IsDisabled") || false;
        if (!IsDisabled) {
          const userRole = extUser.get("UserRole");
          const _currentRole = userRole;
          const menu =
            userRole && userSettings.find((menu) => menu.role === userRole);
          if (menu) {
            const extInfo = JSON.parse(JSON.stringify(extUser));
            const _role = _currentRole.replace("contracts_", "");
            localStorage.setItem("_user_role", _role);
            const redirectUrl =
              location?.state?.from || `/${menu.pageType}/${menu.pageId}`;
            localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
            localStorage.setItem("userEmail", extInfo.Email);
            localStorage.setItem("username", extInfo.Name);
            if (extInfo?.TenantId) {
              const tenant = {
                Id: extInfo?.TenantId?.objectId || "",
                Name: extInfo?.TenantId?.TenantName || ""
              };
              localStorage.setItem("TenantId", tenant?.Id);
              dispatch(showTenant(tenant?.Name));
              localStorage.setItem("TenantName", tenant?.Name);
            }
            localStorage.setItem("PageLanding", menu.pageId);
            localStorage.setItem("defaultmenuid", menu.menuId);
            localStorage.setItem("pageType", menu.pageType);

            const pendingRedirect = sessionStorage.getItem("redirectAfterLogin");
            if (pendingRedirect) {
              try {
                const { docId, contactId } = JSON.parse(pendingRedirect);
                sessionStorage.removeItem("redirectAfterLogin");
                if (docId) {
                  // Antiguo: const targetDoc = contactId ? `/load/recipientSignPdf/${docId}/${contactId}` : `/load/recipientSignPdf/${docId}`;
                  // Redirigir al usuario autenticado a la ruta bajo HomeLayout con barra de navegación e inicio
                  const targetDoc = (contactId && contactId !== "undefined")
                    ? `/recipientSignPdf/${docId}/${contactId}`
                    : `/recipientSignPdf/${docId}`;
                  navigate(targetDoc);
                  return;
                }
              } catch (e) {
                console.error("Error reading redirectAfterLogin in GetLoginData", e);
              }
            }

            navigate(redirectUrl);
          } else {
            setState({ ...state, loading: false });
            logOutUser();
          }
        } else {
          showToast("danger", t("do-not-access-contact-admin"));
          logOutUser();
        }
      } else {
        showToast("danger", t("user-not-found"));
        logOutUser();
      }
    } catch (error) {
      showToast("danger", t("something-went-wrong-mssg"));
      console.log("err", error);
    }
  };

  const togglePasswordVisibility = () => {
    setState({ ...state, passwordVisible: !state.passwordVisible });
  };

  const handleSubmitbtn = async (e) => {
    e.preventDefault();
    if (userDetails.Destination && userDetails.Company) {
      setThirdpartyLoader(true);
      const payload = { sessionToken: localStorage.getItem("accesstoken") };
      const userInformation = JSON.parse(
        localStorage.getItem("UserInformation")
      );
      if (payload && payload.sessionToken) {
        const params = {
          userDetails: {
            name: userInformation.name,
            email: userInformation.email,
            phone: userInformation?.phone || "",
            role: "contracts_User",
            company: userDetails.Company,
            jobTitle: userDetails.Destination,
            timezone: usertimezone
          }
        };
        const userSignUp = await Parse.Cloud.run("usersignup", params);
        if (userSignUp && userSignUp.sessionToken) {
          const LocalUserDetails = {
            name: userInformation.name,
            email: userInformation.email,
            phone: userInformation?.phone || "",
            company: userDetails.Company,
            jobTitle: userDetails.JobTitle
          };
          localStorage.setItem("userDetails", JSON.stringify(LocalUserDetails));
          thirdpartyLoginfn(userSignUp.sessionToken);
        } else {
          alert(userSignUp.message);
        }
      } else if (
        payload &&
        payload.message.replace(/ /g, "_") === "Internal_server_err"
      ) {
        alert(t("server-error"));
      }
    } else {
      showToast("warning", t("fill-required-details!"));
    }
  };

  const logOutUser = async () => {
    setIsModal(false);
    endUserSession();
    try {
      await Parse.User.logOut();
    } catch (err) {
      console.log("Err while logging out", err);
    }
    let appdata = localStorage.getItem("userSettings");
    let applogo = localStorage.getItem("appLogo");
    let defaultmenuid = localStorage.getItem("defaultmenuid");
    let PageLanding = localStorage.getItem("PageLanding");
    let baseUrl = localStorage.getItem("baseUrl");
    let appid = localStorage.getItem("parseAppId");
    let favicon = localStorage.getItem("favicon");

    localStorage.clear();
    saveLanguageInLocal(i18n);

    localStorage.setItem("appLogo", applogo);
    localStorage.setItem("defaultmenuid", defaultmenuid);
    localStorage.setItem("PageLanding", PageLanding);
    localStorage.setItem("userSettings", appdata);
    localStorage.setItem("baseUrl", baseUrl);
    localStorage.setItem("parseAppId", appid);
    localStorage.setItem("favicon", favicon);
  };

  const continueLoginFlow = async () => {
    try {
      const userSettings = appInfo.settings;
      const extUser = await Parse.Cloud.run("getUserDetails");
      if (extUser) {
        const IsDisabled = extUser?.get("IsDisabled") || false;
        if (!IsDisabled) {
          const userRole = extUser?.get("UserRole");
          const menu =
            userRole && userSettings?.find((menu) => menu.role === userRole);
          if (menu) {
            const _currentRole = userRole;
            const redirectUrl =
              location?.state?.from || `/${menu.pageType}/${menu.pageId}`;
            const _role = _currentRole.replace("contracts_", "");
            localStorage.setItem("_user_role", _role);
            const checkLanguage = extUser?.get("Language");
            if (checkLanguage) {
              checkLanguage && i18n.changeLanguage(checkLanguage);
            }
            const extInfo = JSON.parse(JSON.stringify(extUser));
            // Continue with storing user data and redirecting
            localStorage.setItem("Extand_Class", JSON.stringify([extUser]));
            localStorage.setItem("userEmail", extInfo.Email);
            localStorage.setItem("username", extInfo.Name);
            if (extInfo?.TenantId) {
              const tenant = {
                Id: extInfo?.TenantId?.objectId || "",
                Name: extInfo?.TenantId?.TenantName || ""
              };
              localStorage.setItem("TenantId", tenant?.Id);
              dispatch(showTenant(tenant?.Name));
              localStorage.setItem("TenantName", tenant?.Name);
            }
            localStorage.setItem("PageLanding", menu.pageId);
            localStorage.setItem("defaultmenuid", menu.menuId);
            localStorage.setItem("pageType", menu.pageType);
            setState({ ...state, loading: false });

            const pendingRedirect = sessionStorage.getItem("redirectAfterLogin");
            if (pendingRedirect) {
              try {
                const { docId, contactId } = JSON.parse(pendingRedirect);
                sessionStorage.removeItem("redirectAfterLogin");
                if (docId) {
                  // Antiguo: const targetDoc = contactId ? `/load/recipientSignPdf/${docId}/${contactId}` : `/load/recipientSignPdf/${docId}`;
                  // Redirigir al usuario autenticado a la ruta bajo HomeLayout con barra de navegación e inicio
                  const targetDoc = (contactId && contactId !== "undefined")
                    ? `/recipientSignPdf/${docId}/${contactId}`
                    : `/recipientSignPdf/${docId}`;
                  navigate(targetDoc);
                  return;
                }
              } catch (e) {
                console.error("Error reading redirectAfterLogin", e);
              }
            }

            navigate(redirectUrl);
          } else {
            setState({ ...state, loading: false });
            showToast("danger", t("role-not-found"));
            logOutUser();
          }
        } else {
          showToast("danger", t("do-not-access-contact-admin"));
          logOutUser();
        }
      } else {
          showToast("danger", t("user-not-found"));
          logOutUser();
      }
    } catch (error) {
      console.error("Error during login flow", error);
      showToast("danger", error.message || t("something-went-wrong-mssg"));
    }
  };

  return errMsg ? (
    <div className="h-screen flex justify-center text-center items-center p-4 text-gray-500 text-base">
      {errMsg}
    </div>
  ) : (
    <>
      {state.loading && (
        <div
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center bg-black bg-opacity-30 z-50"
        >
          <Loader />
        </div>
      )}
      {appInfo && appInfo.appId ? (
        <>
          <div
            aria-labelledby="loginHeading"
            role="region"
            className="min-h-screen w-full flex items-center justify-center p-3 sm:p-6 md:p-8 lg:p-10 bg-base-200"
          >
            <div className="w-full max-w-[1200px] bg-white text-slate-800 rounded-none sm:rounded-2xl shadow-xl overflow-hidden p-6 sm:p-8 md:p-10 lg:p-12 border border-slate-100">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                {/* Columna Izquierda: Formulario */}
                <div className="lg:col-span-6 xl:col-span-6">
                  {/* Logo e Identidad Corporativa */}
                  <div className="flex items-center gap-3 mb-6 sm:mb-8">
                    {image && (
                      <img
                        src={image}
                        className="object-contain h-10 sm:h-12 max-w-[180px]"
                        alt="Logo Brascuba"
                      />
                    )}
                    <span className="font-bold text-2xl sm:text-3xl text-slate-900 tracking-tight">
                      Firma Digital <span className="text-[#002b6b]">Brascuba</span>
                    </span>
                  </div>

                  <h1 id="loginHeading" className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight leading-tight">
                    {t("welcome")}
                  </h1>
                  <p className="text-[15px] sm:text-base text-[#4b5563] mt-2 mb-6">
                    {t("Login-to-your-account")}
                  </p>

                  {/* Mensaje de alerta / error accesible con role="alert" */}
                  {state.alertMsg && (
                    <div
                      role="alert"
                      aria-live="polite"
                      className={`p-3.5 mb-5 rounded-xl border flex items-center justify-between gap-3 text-sm font-medium ${
                        state.alertType === "danger"
                          ? "bg-red-50 border-red-200 text-red-800"
                          : state.alertType === "info"
                          ? "bg-blue-50 border-blue-200 text-blue-900"
                          : "bg-emerald-50 border-emerald-200 text-emerald-900"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <i
                          className={`text-lg flex-shrink-0 ${
                            state.alertType === "danger"
                              ? "fa-light fa-circle-exclamation text-red-600"
                              : state.alertType === "info"
                              ? "fa-light fa-info-circle text-blue-600"
                              : "fa-light fa-circle-check text-emerald-600"
                          }`}
                        />
                        <span className="leading-snug">{state.alertMsg}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setState((prev) => ({ ...prev, alertMsg: "" }))}
                        className="text-slate-400 hover:text-slate-600 p-1 flex-shrink-0"
                        aria-label="Cerrar aviso"
                      >
                        <i className="fa-light fa-xmark text-sm" />
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleLoginBtn} aria-label="Formulario de inicio de sesión" noValidate={false}>
                    <div className="space-y-5">
                      {/* Campo Usuario o Correo */}
                      <div>
                        <label htmlFor="email" className="block text-[14px] sm:text-[15px] font-semibold text-[#1f2937] mb-2">
                          Usuario o Correo
                        </label>
                        <input
                          id="email"
                          type="text"
                          tabIndex={1}
                          autoFocus
                          autoComplete="username"
                          className="w-full h-12 min-h-[48px] px-4 text-sm sm:text-base text-[#1f2937] bg-white rounded-lg border border-slate-300 placeholder:text-[#6b7280] focus:ring-2 focus:ring-[#002b6b] focus:border-[#002b6b] outline-none transition-all"
                          name="email"
                          placeholder="ej: usuario o usuario@brascuba.cu"
                          value={state.email}
                          onChange={handleChange}
                          required
                          onInvalid={(e) =>
                            e.target.setCustomValidity("Por favor ingrese su usuario o correo institucional.")
                          }
                          onInput={(e) => e.target.setCustomValidity("")}
                        />
                      </div>

                      {/* Campo Contraseña */}
                      <div>
                        <label htmlFor="password" className="block text-[14px] sm:text-[15px] font-semibold text-[#1f2937] mb-2">
                          {t("password")}
                        </label>
                        <div className="relative">
                          <input
                            id="password"
                            type={state.passwordVisible ? "text" : "password"}
                            tabIndex={2}
                            autoComplete="current-password"
                            className="w-full h-12 min-h-[48px] pl-4 pr-12 text-sm sm:text-base text-[#1f2937] bg-white rounded-lg border border-slate-300 placeholder:text-[#6b7280] focus:ring-2 focus:ring-[#002b6b] focus:border-[#002b6b] outline-none transition-all"
                            name="password"
                            placeholder="••••••••"
                            value={state.password}
                            onChange={handleChange}
                            required
                            onInvalid={(e) =>
                              e.target.setCustomValidity("Por favor ingrese su contraseña.")
                            }
                            onInput={(e) => e.target.setCustomValidity("")}
                          />
                          <button
                            type="button"
                            tabIndex={3}
                            aria-label={state.passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-800 focus:outline-none focus:text-[#002b6b]"
                            onClick={togglePasswordVisibility}
                          >
                            <i className={`fa-light ${state.passwordVisible ? "fa-eye-slash" : "fa-eye"} text-base`} />
                          </button>
                        </div>
                      </div>

                      {/* Botón Iniciar Sesión (ancho completo dentro del formulario) */}
                      <div className="pt-3">
                        <button
                          type="submit"
                          tabIndex={4}
                          disabled={state.loading}
                          className="w-full h-12 min-h-[48px] px-6 rounded-lg font-semibold text-base text-white bg-[#002b6b] hover:bg-[#001f4d] active:bg-[#001533] focus:outline-none focus:ring-2 focus:ring-[#002b6b] focus:ring-offset-2 transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
                        >
                          {state.loading ? (
                            <>
                              <i className="fa-light fa-spinner-third fa-spin text-lg" />
                              <span>Iniciando sesión…</span>
                            </>
                          ) : (
                            <span>{t("login")}</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Confianza */}
                  <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                    <i className="fa-light fa-lock-keyhole text-[#002b6b]" />
                    <span>Conexión segura cifrada SSL / TLS</span>
                  </div>
                </div>

                {/* Columna Derecha: Ilustración Brascuba */}
                <div className="hidden lg:flex lg:col-span-6 xl:col-span-6 justify-center items-center p-2 sm:p-4">
                  <div className="w-full max-w-[500px]">
                    <img
                      src={login_img}
                      alt="Firma Digital Brascuba"
                      className="w-full h-auto object-contain rounded-xl"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <ModalUi
            isOpen={isModal}
            title={t("additional-info")}
            showClose={false}
          >
            <form className="px-4 py-3 text-base-content">
              <div className="mb-3">
                <label
                  htmlFor="Company"
                  style={{ display: "flex" }}
                  className="block text-xs font-semibold"
                >
                  {t("company")}{" "}
                  <span className="text-[red] text-[13px]">*</span>
                </label>
                <input
                  type="text"
                  className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                  id="Company"
                  value={userDetails.Company}
                  onChange={(e) =>
                    setUserDetails({
                      ...userDetails,
                      Company: e.target.value
                    })
                  }
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
              </div>
              <div className="mb-3">
                <label
                  htmlFor="JobTitle"
                  style={{ display: "flex" }}
                  className="block text-xs font-semibold"
                >
                  {t("job-title")}
                  <span className="text-[red] text-[13px]">*</span>
                </label>
                <input
                  type="text"
                  className="op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content w-full text-xs"
                  id="JobTitle"
                  value={userDetails.Destination}
                  onChange={(e) =>
                    setUserDetails({
                      ...userDetails,
                      Destination: e.target.value
                    })
                  }
                  onInvalid={(e) =>
                    e.target.setCustomValidity(t("input-required"))
                  }
                  onInput={(e) => e.target.setCustomValidity("")}
                  required
                />
              </div>
              <div className="mt-4 gap-2 flex flex-row">
                <button
                  type="button"
                  className="op-btn op-btn-primary"
                  onClick={(e) => handleSubmitbtn(e)}
                >
                  {t("login")}
                </button>
                <button
                  type="button"
                  className="op-btn op-btn-ghost text-base-content"
                  onClick={logOutUser}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          </ModalUi>
        </>
      ) : (
        <div
          aria-live="assertive"
          className="fixed w-full h-full flex justify-center items-center z-50"
        >
          <Loader />
        </div>
      )}
    </>
  );
}
export default Login;
