import { isUserAdmin } from '../adminHelper.js';
import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
export default async function getDrive(request) {
  const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
  const appId = serverAppId;
  const limit = request.params.limit;
  const skip = request.params.skip;
  const docId = request.params.docId;
  try {
    const userRes = await axios.get(serverUrl + '/users/me', {
      headers: {
        'X-Parse-Application-Id': appId,
        'X-Parse-Session-Token': request.headers['sessiontoken'],
      },
    });
    const userId = userRes.data && userRes.data.objectId;
    const userEmail = userRes.data && userRes.data.email;
    if (userId) {
      try {
        const isAdmin = await isUserAdmin(userEmail, userId);

        const callerExt = await new Parse.Query('contracts_Users')
          .equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId })
          .first({ useMasterKey: true });

        // Para administradores en la raíz de Gestor Pdfs: organizar los documentos en carpetas por usuario
        const isCallerSuperAdmin =
          userEmail === 'admin@brascuba.cu' ||
          callerExt?.get('Email') === 'admin@brascuba.cu' ||
          callerExt?.get('isSuperAdmin') === true;

        if (isAdmin && !docId) {
          const extUserQuery = new Parse.Query('contracts_Users');
          extUserQuery.include('UserId');
          extUserQuery.ascending('Name');
          const extUsers = await extUserQuery.find({ useMasterKey: true });

          // Conteo de elementos en la raíz para cada usuario
          const docCountQuery = new Parse.Query('contracts_Document');
          docCountQuery.notEqualTo('IsArchive', true);
          docCountQuery.notEqualTo('IsPurged', true);
          docCountQuery.doesNotExist('Folder');
          docCountQuery.limit(5000);
          docCountQuery.select('CreatedBy');
          const allDocs = await docCountQuery.find({ useMasterKey: true });
          const countsByUser = {};
          allDocs.forEach((d) => {
            const cId = d.get('CreatedBy')?.id;
            if (cId) countsByUser[cId] = (countsByUser[cId] || 0) + 1;
          });

          const userFolders = extUsers
            .filter((u) => {
              if (!u.get('UserId')) return false;
              const uId = u.get('UserId').id;
              const uEmail = u.get('Email');
              const isSuper =
                uEmail === 'admin@brascuba.cu' || u.get('isSuperAdmin') === true;
              // A los administradores normales nunca les sale la carpeta del Superadmin (pero si es su propia carpeta, siempre se muestra)
              if (isSuper && !isCallerSuperAdmin && uId !== userId) {
                return false;
              }
              return true;
            })
            .map((u) => {
              const uId = u.get('UserId').id;
              const isCurrentAdmin = uId === userId;
              const displayName = u.get('Name') || u.get('Email') || 'Usuario';
              return {
                objectId: `user_${uId}`,
                Name: isCurrentAdmin ? `${displayName} (Mis Documentos)` : displayName,
                Type: 'Folder',
                isUserFolder: true,
                createdAt: u.createdAt,
                updatedAt: u.updatedAt,
                targetUserId: uId,
                Email: u.get('Email'),
                itemCount: countsByUser[uId] || 0,
              };
            });

          // El administrador actual primero, luego el resto en orden alfabético
          userFolders.sort((a, b) => {
            if (a.targetUserId === userId) return -1;
            if (b.targetUserId === userId) return 1;
            return a.Name.localeCompare(b.Name);
          });

          if (skip > 0) {
            return userFolders.slice(skip, skip + limit);
          }
          return userFolders.slice(0, limit);
        }

        let query = new Parse.Query('contracts_Document');
        if (isAdmin) {
          if (docId) {
            if (docId.startsWith('user_')) {
              // El administrador ingresó a la carpeta de un usuario específico
              const targetUserId = docId.replace('user_', '');

              // Si un admin normal intenta acceder a la carpeta del superadmin por URL, bloquear (pero nunca bloquear su propia carpeta)
              if (!isCallerSuperAdmin && targetUserId !== userId) {
                const targetExt = extUsers?.find
                  ? extUsers.find((eu) => eu.get('UserId')?.id === targetUserId)
                  : await new Parse.Query('contracts_Users')
                      .equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: targetUserId })
                      .first({ useMasterKey: true });
                if (targetExt && (targetExt.get('Email') === 'admin@brascuba.cu' || targetExt.get('isSuperAdmin') === true)) {
                  return [];
                }
              }

              query.equalTo('CreatedBy', {
                __type: 'Pointer',
                className: '_User',
                objectId: targetUserId,
              });
              query.doesNotExist('Folder');
            } else {
              // Carpeta normal creada dentro de la jerarquía
              query.equalTo('Folder', {
                __type: 'Pointer',
                className: 'contracts_Document',
                objectId: docId,
              });
              query.include('Folder');
            }
          }
        } else {
          // Usuarios normales: ven sus propios documentos/carpetas y aquellos donde son firmantes
          if (docId) {
            query.equalTo('Folder', {
              __type: 'Pointer',
              className: 'contracts_Document',
              objectId: docId,
            });
            query.include('Folder');
            query.equalTo('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
          } else {
            const userPtr = { __type: 'Pointer', className: '_User', objectId: userId };
            const creatorQuery = new Parse.Query('contracts_Document');
            creatorQuery.equalTo('CreatedBy', userPtr);
            creatorQuery.doesNotExist('Folder');

            const contactQuery = new Parse.Query('contracts_Contactbook');
            contactQuery.equalTo('UserId', userPtr);

            const signerQuery = new Parse.Query('contracts_Document');
            signerQuery.matchesQuery('Signers', contactQuery);
            signerQuery.doesNotExist('Folder');

            query = Parse.Query.or(creatorQuery, signerQuery);
          }
        }
        query.notEqualTo('HiddenForUsers', userId);
        query.include('ExtUserPtr');
        query.include('ExtUserPtr.TenantId');
        query.include('Signers');
        query.notEqualTo('IsArchive', true);
        query.notEqualTo('IsPurged', true);
        query.descending('updatedAt');
        query.skip(skip);
        query.limit(limit);
        query.exclude('AuditTrail');
        query.exclude('OriginalDocument');
        query.exclude('SignedDocument');
        const res = await query.find({ useMasterKey: true });
        return res;
      } catch (err) {
        console.log('err', err);
        return { error: "You don't have access to drive" };
      }
    } else {
      return { error: 'Please provide required parameter!' };
    }
  } catch (err) {
    console.log('err', err?.response?.data || err);
    if (err.code == 209) {
      return { error: 'Invalid session token' };
    } else {
      return { error: "You don't have access!" };
    }
  }
}
