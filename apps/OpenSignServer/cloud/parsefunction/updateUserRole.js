export default async function updateUserRole(request) {
  const { targetUserId, newRole } = request.params;

  if (!request.user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Debe iniciar sesión para realizar esta acción.');
  }

  // 1. Verificar que el usuario que ejecuta la acción sea el Administrador Principal (Superadmin)
  const callerExtQuery = new Parse.Query('contracts_Users');
  callerExtQuery.equalTo('UserId', request.user);
  const callerExt = await callerExtQuery.first({ useMasterKey: true });

  const isCallerSuperAdmin =
    request.user.get('isSuperAdmin') === true ||
    request.user.get('email') === 'admin@brascuba.cu' ||
    callerExt?.get('isSuperAdmin') === true ||
    callerExt?.get('Email') === 'admin@brascuba.cu';

  if (!isCallerSuperAdmin) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Solo el Administrador Principal puede otorgar o revocar privilegios de administrador.'
    );
  }

  // 2. Validar rol solicitado
  const validRoles = ['contracts_Admin', 'contracts_User'];
  if (!validRoles.includes(newRole)) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Rol no válido.');
  }

  // 3. Buscar y actualizar el usuario objetivo en contracts_Users
  const targetQuery = new Parse.Query('contracts_Users');
  const targetExtUser = await targetQuery.get(targetUserId, { useMasterKey: true });

  if (!targetExtUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Usuario objetivo no encontrado.');
  }

  // Prevenir modificar o degradar al Administrador Principal
  const isTargetSuperAdmin =
    targetExtUser.get('isSuperAdmin') === true ||
    targetExtUser.get('Email') === 'admin@brascuba.cu';

  if (isTargetSuperAdmin) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'No se pueden modificar los privilegios del Administrador Principal.'
    );
  }

  // Prevenir que un admin se degrade a sí mismo por error
  if (targetExtUser.id === callerExt?.id && newRole !== 'contracts_Admin') {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'No puede revocar sus propios privilegios de administrador.'
    );
  }

  targetExtUser.set('UserRole', newRole);
  await targetExtUser.save(null, { useMasterKey: true });

  console.log(
    `[Role Updated] Administrador ${callerExt.get('Email')} asignó rol ${newRole} al usuario ${targetExtUser.get('Email')}`
  );

  return {
    success: true,
    objectId: targetExtUser.id,
    newRole: newRole,
  };
}
