import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { authenticateLdap } from './ldapService.js';

const serverUrl = cloudServerUrl;
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;

export default async function loginUser(request) {
  const inputIdentifier = (request.params.email || '').trim().toLowerCase();
  const password = request.params.password;

  if (!inputIdentifier || !password) {
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'Usuario o contraseña requeridos.');
  }

  const isLdapEnabled =
    process.env.LDAP_ENABLED === 'true' || process.env.LDAP_ENABLED === true;

  // 1. Normalizar identificador para admitir alias (ej: leandro.valdes) y correo (ej: leandro.valdes@brascuba.cu)
  const LDAP_DOMAIN = process.env.LDAP_DOMAIN || 'brascuba.cu';
  let shortName = inputIdentifier;
  let fullEmail = inputIdentifier;

  if (inputIdentifier.includes('@')) {
    shortName = inputIdentifier.split('@')[0];
  } else {
    fullEmail = `${inputIdentifier}@${LDAP_DOMAIN}`;
  }

  // 2. Buscar usuario registrado en contracts_Users (registro corporativo obligatorio)
  const extQ1 = new Parse.Query('contracts_Users').equalTo('Email', fullEmail);
  const extQ2 = new Parse.Query('contracts_Users').equalTo('Email', inputIdentifier);
  const extUserQuery = Parse.Query.or(extQ1, extQ2);
  extUserQuery.include('UserId');
  let extUser = await extUserQuery.first({ useMasterKey: true });

  let user = null;
  if (extUser) {
    user = extUser.get('UserId');
    if (!user || !user.id) {
      const qEmail = new Parse.Query(Parse.User).equalTo('email', fullEmail);
      const qUsername = new Parse.Query(Parse.User).equalTo('username', fullEmail);
      const qShort = new Parse.Query(Parse.User).equalTo('username', shortName);
      const candidateUser = await Parse.Query.or(qEmail, qUsername, qShort).first({ useMasterKey: true });
      if (candidateUser) {
        user = candidateUser;
        extUser.set('UserId', candidateUser);
        await extUser.save(null, { useMasterKey: true });
      }
    }
  } else {
    // Si no se encontró por Email directo, verificar si existe en Parse.User y si tiene contracts_Users vinculado
    const qEmail = new Parse.Query(Parse.User).equalTo('email', fullEmail);
    const qUsername = new Parse.Query(Parse.User).equalTo('username', fullEmail);
    const qShort = new Parse.Query(Parse.User).equalTo('username', shortName);
    const qRaw = new Parse.Query(Parse.User).equalTo('username', inputIdentifier);
    const candidateUser = await Parse.Query.or(qEmail, qUsername, qShort, qRaw).first({ useMasterKey: true });
    if (candidateUser) {
      const extQ = new Parse.Query('contracts_Users');
      extQ.equalTo('UserId', candidateUser);
      extUser = await extQ.first({ useMasterKey: true });
      if (extUser) {
        user = candidateUser;
      }
    }
  }

  // REQUISITO ESTRICTO: Solo usuarios previamente registrados en contracts_Users por el Superadmin pueden acceder.
  // Queda terminantemente prohibido cualquier auto-registro o acceso sin cuenta previa.
  if (!user || !extUser) {
    console.warn(
      `[Login Rejected] Intento de acceso de usuario no registrado en contracts_Users: ${inputIdentifier}`
    );
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'Usuario no autorizado o no registrado en el sistema. Contacte al administrador.'
    );
  }

  // 3. Verificar si el usuario está deshabilitado
  if (extUser && extUser.get('IsDisabled') === true) {
    throw new Parse.Error(
      1001,
      'Su cuenta se encuentra deshabilitada en la plataforma. Contacte al administrador.'
    );
  }

  // 4. Determinar si es Superadmin o si su método de acceso es LDAP vs Local
  const superAdminEmail = (process.env.SUPERADMIN_EMAIL || 'admin@brascuba.cu').trim().toLowerCase();
  const isSuperAdminUser =
    user.get('isSuperAdmin') === true ||
    user.get('email') === superAdminEmail ||
    fullEmail === superAdminEmail ||
    (extUser && (extUser.get('isSuperAdmin') === true || extUser.get('Email') === superAdminEmail));

  // El Superadmin siempre usa contraseña local; los demás usuarios según su campo isLdap
  const isLdapUser =
    !isSuperAdminUser &&
    (user.get('isLdap') === true || (extUser && extUser.get('isLdap') === true));

  // 5. Flujo A: Autenticación mediante LDAP / Directorio Activo
  if (isLdapEnabled && isLdapUser) {
    try {
      const ldapUser = await authenticateLdap(shortName, password);
      if (!ldapUser || !ldapUser.authenticated) {
        throw new Parse.Error(
          Parse.Error.OBJECT_NOT_FOUND,
          'Credenciales inválidas en Directorio Activo.'
        );
      }

      // Sincronizar nombre si varió en el Directorio Activo
      if (ldapUser.name) {
        if (user.get('name') !== ldapUser.name) {
          user.set('name', ldapUser.name);
          await user.save(null, { useMasterKey: true });
        }
        if (extUser && extUser.get('Name') !== ldapUser.name) {
          extUser.set('Name', ldapUser.name);
          await extUser.save(null, { useMasterKey: true });
        }
      }

      // Generar sesión oficial con /loginAs
      const url = `${serverUrl}/loginAs`;
      const axiosRes = await axios({
        method: 'POST',
        url: url,
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          'X-Parse-Application-Id': APPID,
          'X-Parse-Master-Key': masterKEY,
        },
        params: {
          userId: user.id,
        },
      });

      const login = axiosRes.data;
      return {
        ...user.toJSON(),
        sessionToken: login.sessionToken,
      };
    } catch (ldapErr) {
      console.error('[LDAP Auth Failed]:', ldapErr.message);
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        ldapErr.message || 'Credenciales inválidas en Directorio Activo.'
      );
    }
  }

  // 6. Flujo B: Autenticación con contraseña local de Parse
  try {
    const parseUsername = user.get('username') || fullEmail;
    const loggedUser = await Parse.User.logIn(parseUsername, password);
    if (loggedUser) {
      return {
        ...loggedUser.toJSON(),
      };
    } else {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Usuario o contraseña incorrectos.');
    }
  } catch (err) {
    console.log(`Error en autenticación local de usuario (${inputIdentifier}):`, err.message);
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'Usuario o contraseña incorrectos.'
    );
  }
}
