export default async function toggleUserAuthType(request) {
  const { targetUserId, isLdap } = request.params;

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
      'Solo el Administrador Principal puede cambiar el método de autenticación.'
    );
  }

  // 2. Buscar el usuario objetivo en contracts_Users
  const targetQuery = new Parse.Query('contracts_Users');
  targetQuery.include('UserId');
  const targetExtUser = await targetQuery.get(targetUserId, { useMasterKey: true });

  if (!targetExtUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Usuario objetivo no encontrado.');
  }

  // Prevenir cambiar el método de autenticación al Superadmin
  const isTargetSuper =
    targetExtUser.get('isSuperAdmin') === true ||
    targetExtUser.get('Email') === 'admin@brascuba.cu';

  if (isTargetSuper) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'El Administrador Principal siempre utiliza autenticación local.'
    );
  }

  const newIsLdap = Boolean(isLdap);
  targetExtUser.set('isLdap', newIsLdap);
  await targetExtUser.save(null, { useMasterKey: true });

  let targetUserObj = targetExtUser.get('UserId');
  if (!targetUserObj || !targetUserObj.id) {
    const uq = new Parse.Query(Parse.User);
    uq.equalTo('email', targetExtUser.get('Email'));
    targetUserObj = await uq.first({ useMasterKey: true });
    if (targetUserObj) {
      targetExtUser.set('UserId', targetUserObj);
      await targetExtUser.save(null, { useMasterKey: true });
    }
  }
  if (targetUserObj) {
    targetUserObj.set('isLdap', newIsLdap);
    await targetUserObj.save(null, { useMasterKey: true });
  }

  console.log(
    `[Auth Type Changed] Usuario ${targetExtUser.get('Email')} configurado a: ${newIsLdap ? 'LDAP' : 'Local'}`
  );

  return {
    status: 'success',
    success: true,
    objectId: targetExtUser.id,
    isLdap: newIsLdap,
  };
}
