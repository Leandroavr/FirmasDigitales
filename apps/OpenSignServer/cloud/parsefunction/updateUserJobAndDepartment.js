export default async function updateUserJobAndDepartment(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }

  const { extUserId, jobTitle, department, hierarchyLevel, reportsTo } = request.params;
  const trimmedJobTitle = typeof jobTitle === 'string' ? jobTitle.trim() : '';
  const trimmedDepartment = typeof department === 'string' ? department.trim() : '';
  const trimmedHierarchyLevel = typeof hierarchyLevel === 'string' ? hierarchyLevel.trim() : '';
  const trimmedReportsTo = typeof reportsTo === 'string' ? reportsTo.trim() : '';

  if (!extUserId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'ID de usuario requerido.');
  }
  if (!trimmedJobTitle) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'El cargo es obligatorio y no puede estar vacío.');
  }
  if (!trimmedDepartment) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'El departamento es obligatorio y no puede estar vacío.');
  }

  // Verificar que el usuario que llama sea Administrador Principal
  const currentUser = { __type: 'Pointer', className: '_User', objectId: request.user.id };
  const callerQuery = new Parse.Query('contracts_Users');
  callerQuery.equalTo('UserId', currentUser);
  callerQuery.notEqualTo('IsDisabled', true);
  const callerExtUser = await callerQuery.first({ useMasterKey: true });

  const isCallerSuperAdmin =
    request.user.get('isSuperAdmin') === true ||
    request.user.get('email') === 'admin@brascuba.cu' ||
    callerExtUser?.get('isSuperAdmin') === true ||
    callerExtUser?.get('Email') === 'admin@brascuba.cu';

  if (!isCallerSuperAdmin) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Solo el Administrador Principal puede editar el cargo y departamento de los usuarios.'
    );
  }

  const targetQuery = new Parse.Query('contracts_Users');
  const targetUser = await targetQuery.get(extUserId, { useMasterKey: true });
  if (!targetUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Usuario no encontrado.');
  }

  targetUser.set('JobTitle', trimmedJobTitle);
  targetUser.set('Department', trimmedDepartment);
  targetUser.set('HierarchyLevel', trimmedHierarchyLevel);
  targetUser.set('ReportsTo', trimmedReportsTo);
  await targetUser.save(null, { useMasterKey: true });

  // Sincronizar en contracts_Contactbook si existe para el mismo correo
  const userEmail = (targetUser.get('Email') || '').toLowerCase().trim();
  if (userEmail) {
    try {
      const contactQuery = new Parse.Query('contracts_Contactbook');
      contactQuery.equalTo('Email', userEmail);
      const contact = await contactQuery.first({ useMasterKey: true });
      if (contact) {
        contact.set('JobTitle', trimmedJobTitle);
        contact.set('Department', trimmedDepartment);
        contact.set('HierarchyLevel', trimmedHierarchyLevel);
        contact.set('ReportsTo', trimmedReportsTo);
        await contact.save(null, { useMasterKey: true });
      }
    } catch (contactErr) {
      console.warn('Error sincronizando cargo/departamento en Contactbook:', contactErr);
    }
  }

  return {
    status: 'success',
    message: 'Datos del usuario actualizados exitosamente en el organigrama.',
    user: {
      objectId: targetUser.id,
      JobTitle: trimmedJobTitle,
      Department: trimmedDepartment,
      HierarchyLevel: trimmedHierarchyLevel,
      ReportsTo: trimmedReportsTo,
    },
  };
}
