import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import login_img from "../assets/images/brascuba_login.jpg";
import { appInfo } from "../constant/appinfo";

function ForgotPassword() {
  const navigate = useNavigate();
  const [image, setImage] = useState();
  const [isMobile, setIsMobile] = useState(false);

  const resize = () => {
    setIsMobile(window.innerWidth <= 760);
  };

  useEffect(() => {
    setImage(appInfo?.applogo || undefined);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <div className="min-h-screen flex flex-col justify-center p-4 md:p-10 lg:p-16">
      <div className="md:p-4 lg:p-10 p-4 bg-base-100 text-base-content op-card max-w-4xl mx-auto shadow-lg">
        <div className="flex items-center gap-3 h-[50px] md:h-[60px] overflow-hidden">
          {image && (
            <img
              src={image}
              className="object-contain h-full"
              alt="applogo"
            />
          )}
          <span className="font-bold text-2xl md:text-3xl text-base-content tracking-tight">
            Firma Digital Brascuba
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-6 items-center">
          <div>
            <h2 className="text-2xl font-bold text-base-content">
              Restablecimiento de Contraseña
            </h2>
            <div className="mt-4 p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-sm leading-relaxed">
              <p className="font-semibold mb-2">
                <i className="fa-light fa-info-circle mr-1.5 text-blue-600"></i>
                Autenticación Corporativa
              </p>
              <p>
                Las cuentas de usuario y contraseñas de esta plataforma están integradas con el Directorio Activo / LDAP de la empresa.
              </p>
              <p className="mt-2">
                Si ha olvidado su contraseña o su cuenta se encuentra bloqueada, por favor comuníquese directamente con el <strong>Departamento de Tecnología (TI)</strong> o utilice el portal interno de autoservicio de contraseñas de la institución.
              </p>
            </div>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                className="op-btn op-btn-primary w-full md:w-auto px-6 font-bold"
              >
                <i className="fa-light fa-arrow-left mr-2"></i>
                Volver al Inicio de Sesión
              </button>
            </div>
          </div>
          {!isMobile && (
            <div className="self-center flex justify-center">
              <img
                src={login_img}
                alt="Firma Digital Brascuba"
                className="w-[320px] lg:w-[420px] h-auto object-contain rounded-xl"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
