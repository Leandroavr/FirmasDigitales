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

        // Para administradores en la raíz de Gestor Pdfs: organizar los documentos en carpetas por usuario
        if (isAdmin && !docId) {
          const extUserQuery = new Parse.Query('contracts_Users');
          extUserQuery.include('UserId');
          extUserQuery.ascending('Name');
          const extUsers = await extUserQuery.find({ useMasterKey: true });

          // Conteo de elementos en la raíz para cada usuario
          const docCountQuery = new Parse.Query('contracts_Document');
          docCountQuery.notEqualTo('IsArchive', true);
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
            .filter((u) => u.get('UserId'))
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

        const query = new Parse.Query('contracts_Document');
        if (isAdmin) {
          if (docId) {
            if (docId.startsWith('user_')) {
              // El administrador ingresó a la carpeta de un usuario específico
              const targetUserId = docId.replace('user_', '');
              query.equalTo('CreatedBy', {
                __type: 'Pointer',
                className: '_User',
                objectId: targetUserId,
              });
              query.doesNotExist('Folder', true);
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
          // Usuarios normales: sólo ven sus propios documentos y carpetas
          if (docId) {
            query.equalTo('Folder', {
              __type: 'Pointer',
              className: 'contracts_Document',
              objectId: docId,
            });
            query.include('Folder');
          } else {
            query.doesNotExist('Folder', true);
          }
          query.equalTo('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
        }
        query.include('ExtUserPtr');
        query.include('ExtUserPtr.TenantId');
        query.include('Signers');
        query.notEqualTo('IsArchive', true);
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
