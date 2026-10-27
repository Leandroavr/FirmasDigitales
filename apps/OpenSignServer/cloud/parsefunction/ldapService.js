import ldap from 'ldapjs';

/**
 * Servicio de autenticación y consulta para Active Directory / LDAP de Brascuba
 */
export async function authenticateLdap(identifier, password) {
  const LDAP_URL = process.env.LDAP_URL || 'ldap://brascuba.cu:389';
  const LDAP_BASE_DN = process.env.LDAP_BASE_DN || 'OU=BC,DC=brascuba,DC=cu';
  const LDAP_DOMAIN = process.env.LDAP_DOMAIN || 'brascuba.cu';
  const LDAP_FILTER =
    process.env.LDAP_FILTER ||
    '(&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))';
  const LDAP_TIMEOUT = parseInt(process.env.LDAP_TIMEOUT || '5000', 10);

  let upn = (identifier || '').trim().toLowerCase();
  let shortName = upn;

  if (!upn.includes('@')) {
    shortName = upn;
    upn = `${upn}@${LDAP_DOMAIN}`;
  } else {
    shortName = upn.split('@')[0];
  }

  return new Promise((resolve, reject) => {
    let clientClosed = false;
    let client;

    try {
      client = ldap.createClient({
        url: LDAP_URL,
        timeout: LDAP_TIMEOUT,
        connectTimeout: LDAP_TIMEOUT,
      });
    } catch (e) {
      return reject(new Error(`Error inicializando cliente LDAP: ${e.message}`));
    }

    const safeUnbind = () => {
      if (!clientClosed) {
        clientClosed = true;
        try {
          client.unbind();
        } catch (e) {
          /* best effort */
        }
      }
    };

    // Timeout de seguridad en caso de red colgada
    const timer = setTimeout(() => {
      safeUnbind();
      reject(new Error(`Tiempo de espera agotado conectando al servidor LDAP (${LDAP_URL})`));
    }, LDAP_TIMEOUT + 1000);

    client.on('error', (err) => {
      clearTimeout(timer);
      safeUnbind();
      console.error(`[LDAP Client Error] Servidor ${LDAP_URL}:`, err.message);
      reject(new Error(`No se pudo conectar con el servidor corporativo LDAP (${LDAP_URL}). Verifique su conexión VPN.`));
    });

    // 1. Intentar Bind con el UPN y contraseña del usuario
    client.bind(upn, password, (bindErr) => {
      if (bindErr) {
        clearTimeout(timer);
        safeUnbind();
        console.warn(`[LDAP Bind Failed] Usuario: ${upn}, Razón:`, bindErr.message);
        return reject(new Error('Credenciales inválidas en Directorio Activo o cuenta no autorizada.'));
      }

      console.log(`[LDAP Bind Success] Usuario autenticado correctamente: ${upn}`);

      // 2. Consultar atributos del usuario en BaseDN
      const searchFilter = `(&${LDAP_FILTER}(|(userPrincipalName=${upn})(mail=${upn})(sAMAccountName=${shortName})))`;
      const opts = {
        filter: searchFilter,
        scope: 'sub',
        attributes: [
          'dn',
          'cn',
          'displayName',
          'mail',
          'userPrincipalName',
          'sAMAccountName',
          'title',
          'department',
          'company',
          'telephoneNumber',
          'mobile'
        ],
        timeLimit: 5,
      };

      let foundEntry = null;

      client.search(LDAP_BASE_DN, opts, (searchErr, res) => {
        if (searchErr) {
          clearTimeout(timer);
          safeUnbind();
          console.warn('[LDAP Search Warn]:', searchErr.message);
          // Si el bind fue exitoso pero la búsqueda falló, permitimos el acceso con datos básicos
          return resolve({
            authenticated: true,
            email: upn,
            name: shortName,
            username: shortName,
            upn: upn,
          });
        }

        res.on('searchEntry', (entry) => {
          foundEntry = entry.object;
        });

        res.on('error', (resErr) => {
          clearTimeout(timer);
          safeUnbind();
          console.warn('[LDAP Search Entry Error]:', resErr.message);
          resolve({
            authenticated: true,
            email: upn,
            name: shortName,
            username: shortName,
            upn: upn,
          });
        });

        res.on('end', () => {
          clearTimeout(timer);
          safeUnbind();
          if (foundEntry) {
            const name = foundEntry.displayName || foundEntry.cn || shortName;
            const email = (foundEntry.mail || foundEntry.userPrincipalName || upn)
              .toLowerCase()
              .replace(/\s/g, '');
            resolve({
              authenticated: true,
              name: name,
              email: email,
              username: shortName,
              upn: upn,
              jobTitle: foundEntry.title || '',
              department: foundEntry.department || '',
              company: foundEntry.company || 'Brascuba',
              phone: foundEntry.telephoneNumber || foundEntry.mobile || '',
              dn: foundEntry.dn,
            });
          } else {
            resolve({
              authenticated: true,
              name: shortName,
              email: upn,
              username: shortName,
              upn: upn,
              company: 'Brascuba',
            });
          }
        });
      });
    });
  });
}

export default authenticateLdap;
