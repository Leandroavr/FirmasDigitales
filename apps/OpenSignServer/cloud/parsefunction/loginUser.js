import crypto from 'node:crypto';
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
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'username/password is missing.');
  }

  const isLdapEnabled =
    process.env.LDAP_ENABLED === 'true' || process.env.LDAP_ENABLED === true;

  // 1. Identificar si el usuario es Superadmin local
  const superAdminEmail = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  let localUser = null;

  try {
    const userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('username', inputIdentifier);
    localUser = await userQuery.first({ useMasterKey: true });
    if (!localUser) {
      const emailQuery = new Parse.Query(Parse.User);
      emailQuery.equalTo('email', inputIdentifier);
      localUser = await emailQuery.first({ useMasterKey: true });
    }
  } catch (e) {
    console.error('Error buscando usuario local:', e);
  }

  const isLocalSuperAdmin =
    localUser &&
    (localUser.get('isSuperAdmin') === true ||
      localUser.get('isLdap') === false ||
      (superAdminEmail &&
        (inputIdentifier === superAdminEmail ||
          localUser.get('email') === superAdminEmail)));

  // 2. Si LDAP está habilitado y NO es un superadmin local:
  if (isLdapEnabled && !isLocalSuperAdmin) {
    try {
      // Autenticar estrictamente con LDAP
      const ldapUser = await authenticateLdap(inputIdentifier, password);
      if (!ldapUser || !ldapUser.authenticated) {
        throw new Parse.Error(
          Parse.Error.OBJECT_NOT_FOUND,
          'Credenciales inválidas en Directorio Activo.'
        );
      }

      const normalizedEmail = (ldapUser.email || inputIdentifier)
        .toLowerCase()
        .replace(/\s/g, '');

      // Buscar si el usuario ya existe en OpenSign
      const query = new Parse.Query(Parse.User);
      query.equalTo('email', normalizedEmail);
      let user = await query.first({ useMasterKey: true });

      if (!user) {
        const userQ = new Parse.Query(Parse.User);
        userQ.equalTo('username', normalizedEmail);
        user = await userQ.first({ useMasterKey: true });
      }

      if (user) {
        // Usuario existente: verificar si está deshabilitado
        const extQuery = new Parse.Query('contracts_Users');
        extQuery.equalTo('UserId', user);
        const extUser = await extQuery.first({ useMasterKey: true });

        if (extUser && extUser.get('IsDisabled') === true) {
          throw new Parse.Error(
            1001,
            'Su cuenta se encuentra deshabilitada en la plataforma. Contacte al administrador.'
          );
        }

        // Actualizar nombre si cambió en el Directorio Activo
        if (ldapUser.name && user.get('name') !== ldapUser.name) {
          user.set('name', ldapUser.name);
          await user.save(null, { useMasterKey: true });
        }
        if (extUser && ldapUser.name && extUser.get('Name') !== ldapUser.name) {
          extUser.set('Name', ldapUser.name);
          await extUser.save(null, { useMasterKey: true });
        }
      } else {
        // Just-In-Time Provisioning: Registrar automáticamente por primera vez
        const randomPassword = crypto.randomBytes(32).toString('hex');
        user = new Parse.User();
        user.set('username', normalizedEmail);
        user.set('email', normalizedEmail);
        user.set('name', ldapUser.name || normalizedEmail.split('@')[0]);
        user.set('password', randomPassword);
        user.set('isLdap', true);
        if (ldapUser.phone) user.set('phone', ldapUser.phone);
        await user.signUp(null, { useMasterKey: true });

        // Obtener el Tenant por defecto (Brascuba)
        const tenantQuery = new Parse.Query('partners_Tenant');
        const defaultTenant = await tenantQuery.first({ useMasterKey: true });

        // Obtener organización por defecto
        const orgQuery = new Parse.Query('contracts_Organizations');
        const defaultOrg = await orgQuery.first({ useMasterKey: true });

        const extUser = new Parse.Object('contracts_Users');
        extUser.set('Name', ldapUser.name || normalizedEmail.split('@')[0]);
        extUser.set('Email', normalizedEmail);
        extUser.set('UserRole', 'contracts_User');
        extUser.set('UserId', user);
        extUser.set('Company', ldapUser.company || 'Brascuba');
        extUser.set('JobTitle', ldapUser.jobTitle || '');
        extUser.set('Department', ldapUser.department || '');
        extUser.set('IsDisabled', false);
        if (defaultTenant) {
          extUser.set('TenantId', defaultTenant);
        }
        if (defaultOrg) {
          extUser.set('OrganizationId', defaultOrg);
        }
        await extUser.save(null, { useMasterKey: true });
        console.log(`[LDAP Provisioning] Nuevo usuario aprovisionado: ${normalizedEmail} (${ldapUser.name})`);
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

  // 3. Fallback: Autenticación local en Parse para SuperAdmin o cuando LDAP_ENABLED=false
  try {
    const user = await Parse.User.logIn(inputIdentifier, password);
    if (user) {
      return {
        ...user.toJSON(),
      };
    } else {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Usuario no encontrado.');
    }
  } catch (err) {
    console.log('Error en autenticación local de usuario:', err.message);
    throw err;
  }
}
