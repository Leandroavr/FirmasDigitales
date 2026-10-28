export default async function hideDocumentForUser(req) {
  const docId = req.params?.docId || req.params?.objectId;
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Se requiere el ID del documento (docId).');
  }

  let user = req.user;
  const sessionToken = req.headers?.['sessiontoken'] || req.headers?.['x-parse-session-token'];
  if (!user && sessionToken) {
    try {
      user = await Parse.User.become(sessionToken);
    } catch (_) {}
  }

  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Sesión no válida o no autenticada.');
  }

  const query = new Parse.Query('contracts_Document');
  const doc = await query.get(docId, { useMasterKey: true });
  if (!doc) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Documento no encontrado.');
  }

  // Agregar el id del usuario al arreglo HiddenForUsers de forma única
  doc.addUnique('HiddenForUsers', user.id);
  await doc.save(null, { useMasterKey: true });

  return {
    status: 'success',
    message: 'El documento ha sido ocultado de tu lista.',
  };
}
