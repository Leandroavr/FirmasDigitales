import React, { useEffect } from "react";
import Parse from "parse";
import { Outlet } from "react-router";
import { saveLanguageInLocal } from "../constant/Utils";
import { useTranslation } from "react-i18next";
import { validateSessionOnStartup, endUserSession } from "../utils/sessionManager";
const ValidateRoute = () => {
  const { i18n } = useTranslation();
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accesstoken");
      if (token) {
        if (!validateSessionOnStartup()) {
          handlelogout();
          return;
        }
        try {
          // Antiguo:
          // const userQuery = new Parse.Query(Parse.User);
          // const user = await userQuery.get(Parse?.User?.current()?.id, {
          //   sessionToken: localStorage.getItem("accesstoken")
          // });
          // if (!user) { handlelogout(); }

          // En recarga o nueva pestaña, Parse.User.current() no siempre está en memoria de inmediato.
          // Parse.User.become(token) hidrata la sesión de forma segura contra el servidor Parse.
          let currentUser = Parse.User.current();
          if (!currentUser) {
            currentUser = await Parse.User.become(token);
          } else {
            const userQuery = new Parse.Query(Parse.User);
            await userQuery.get(currentUser.id, {
              sessionToken: token
            });
          }
          if (!currentUser) {
            handlelogout();
          }
        } catch (error) {
          console.log("err in validate route", error);
          // Solo invalidar si el token expiró o fue rechazado explícitamente por el servidor (código 209)
          if (error?.code === 209 || error?.message?.includes("invalid session") || error?.message?.includes("Invalid session")) {
            handlelogout();
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handlelogout = async () => {
    endUserSession();
    try {
      await Parse.User.logOut();
    } catch (e) {}
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
  return <>{<Outlet />}</>;
};

export default ValidateRoute;
