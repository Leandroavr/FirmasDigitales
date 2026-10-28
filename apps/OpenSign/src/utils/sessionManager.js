import { sessionStatus } from "../redux/reducers/userReducer";
import Parse from "parse";

// Tiempo de inactividad: 30 minutos en milisegundos (30 * 60 * 1000)
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

// Nombre de la cookie de sesión del navegador (sin Expires/Max-Age: se borra al cerrar el navegador)
const BROWSER_SESSION_COOKIE = "opensign_browser_session";

/**
 * Establece la cookie de sesión del navegador.
 * Al no tener fecha de expiración, el navegador la elimina automáticamente al cerrarse.
 */
export function setBrowserSessionCookie() {
  try {
    document.cookie = `${BROWSER_SESSION_COOKIE}=active; path=/; SameSite=Lax`;
  } catch (err) {
    console.warn("[SessionManager] Error configurando cookie de sesión:", err);
  }
}

/**
 * Comprueba si la cookie de sesión del navegador sigue presente.
 * Si el navegador se cerró por completo y se volvió a abrir, esta cookie habrá desaparecido.
 */
export function isBrowserSessionActive() {
  try {
    return document.cookie
      .split(";")
      .some((item) => item.trim().startsWith(`${BROWSER_SESSION_COOKIE}=`));
  } catch (err) {
    return true;
  }
}

/**
 * Elimina la cookie de sesión del navegador al hacer logout explícito.
 */
export function deleteBrowserSessionCookie() {
  try {
    document.cookie = `${BROWSER_SESSION_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  } catch (err) {
    console.warn("[SessionManager] Error borrando cookie de sesión:", err);
  }
}

/**
 * Limpia los tokens locales y cierra sesión en Parse.
 */
export function cleanLocalTokens() {
  try {
    localStorage.removeItem("accesstoken");
    localStorage.removeItem("last_activity_time");
    localStorage.removeItem("session_login_time");
    sessionStorage.removeItem("opensign_tab_active");
    deleteBrowserSessionCookie();
    if (typeof Parse !== "undefined" && Parse?.User) {
      Parse.User.logOut().catch(() => {});
    }
  } catch (err) {
    console.warn("[SessionManager] Error limpiando tokens:", err);
  }
}

/**
 * Inicia una sesión activa tras un login exitoso.
 */
export function startUserSession() {
  setBrowserSessionCookie();
  const now = Date.now().toString();
  localStorage.setItem("last_activity_time", now);
  localStorage.setItem("session_login_time", now);
  sessionStorage.setItem("opensign_tab_active", "1");
}

/**
 * Cierra la sesión activa del usuario.
 */
export function endUserSession() {
  cleanLocalTokens();
}

/**
 * Valida la sesión en el arranque o recarga de la página:
 * 1. Comprueba si el navegador fue cerrado previamente (Opción 3).
 * 2. Comprueba si pasaron más de 30 minutos de inactividad (Opción 1).
 * Retorna true si la sesión es válida, false si expiró.
 */
export function validateSessionOnStartup(dispatch) {
  const token = localStorage.getItem("accesstoken");
  if (!token) return false;

  // Opción 3: Si no existe la cookie de sesión, el navegador fue cerrado y reabierto
  if (!isBrowserSessionActive()) {
    console.log("[SessionManager] El navegador fue cerrado previamente. Sesión finalizada.");
    cleanLocalTokens();
    if (dispatch) {
      dispatch(sessionStatus(false));
    }
    return false;
  }

  // Opción 1: Comprobar si transcurrieron más de 30 minutos de inactividad
  const lastActivity = parseInt(localStorage.getItem("last_activity_time") || "0", 10);
  if (lastActivity > 0 && Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
    console.log("[SessionManager] Inactividad superior a 30 minutos detectada en arranque. Sesión expirada.");
    cleanLocalTokens();
    if (dispatch) {
      dispatch(sessionStatus(false));
    }
    return false;
  }

  // Renovar marca de tiempo de actividad
  localStorage.setItem("last_activity_time", Date.now().toString());
  setBrowserSessionCookie();
  return true;
}

let isTrackerActive = false;
let lastActivitySaved = 0;

/**
 * Inicia el rastreador de inactividad de 30 minutos y verificación continua.
 */
export function initInactivityTracker(dispatch) {
  if (typeof window === "undefined") return () => {};
  if (isTrackerActive) return () => {};
  isTrackerActive = true;

  // Registrar actividad del usuario (limitada a un guardado cada 10 segundos para no saturar)
  const handleUserActivity = () => {
    const token = localStorage.getItem("accesstoken");
    if (!token) return;

    const now = Date.now();
    if (now - lastActivitySaved > 10000) {
      lastActivitySaved = now;
      localStorage.setItem("last_activity_time", now.toString());
      setBrowserSessionCookie();
    }
  };

  const activityEvents = [
    "mousedown",
    "mousemove",
    "keydown",
    "scroll",
    "touchstart",
    "click"
  ];

  activityEvents.forEach((evt) => {
    window.addEventListener(evt, handleUserActivity, { passive: true });
  });

  // Temporizador cada 10 segundos para verificar inactividad y cierre de navegador
  const intervalId = setInterval(() => {
    const token = localStorage.getItem("accesstoken");
    if (!token) return;

    // 1. Verificar si la cookie de sesión del navegador desapareció (Opción 3)
    if (!isBrowserSessionActive()) {
      console.log("[SessionManager] Cookie de sesión de navegador no encontrada. Cerrando sesión...");
      cleanLocalTokens();
      if (dispatch) {
        dispatch(sessionStatus(false));
      }
      return;
    }

    // 2. Verificar inactividad de 30 minutos (Opción 1)
    const lastActivity = parseInt(localStorage.getItem("last_activity_time") || "0", 10);
    const now = Date.now();
    if (lastActivity > 0 && now - lastActivity > INACTIVITY_TIMEOUT_MS) {
      console.log("[SessionManager] 30 minutos de inactividad alcanzados. Sesión expirada.");
      cleanLocalTokens();
      if (dispatch) {
        dispatch(sessionStatus(false));
      }
    }
  }, 10000);

  // Sincronizar logout o cambios entre pestañas del navegador
  const handleStorageEvent = (e) => {
    if (e.key === "accesstoken" && !e.newValue) {
      cleanLocalTokens();
      if (dispatch) {
        dispatch(sessionStatus(false));
      }
    }
  };
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    clearInterval(intervalId);
    activityEvents.forEach((evt) => {
      window.removeEventListener(evt, handleUserActivity);
    });
    window.removeEventListener("storage", handleStorageEvent);
    isTrackerActive = false;
  };
}
