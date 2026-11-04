export async function userBeforeSave(request) {
  const { object, user, master } = request;
  if (master) return;
  if (!user) {
    if (!object.isNew()) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Sesión no válida.');
    }
    return;
  }

  // Si es una actualización de un usuario existente
  if (!object.isNew()) {
    const isSuperAdmin =
      user.get('isSuperAdmin') === true ||
      (user.get('email') || '').toLowerCase().trim() === 'admin@brascuba.cu';

    if (!isSuperAdmin) {
      // El usuario solo puede editar su propio objeto de usuario
      if (object.id !== user.id) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'No tienes permiso para modificar otros usuarios.');
      }
      // Verificar campos modificados: solo ProfilePic y phone
      const dirtyKeys = object.dirtyKeys();
      const allowedKeys = ['ProfilePic', 'phone'];
      const forbiddenKeys = dirtyKeys.filter(k => !allowedKeys.includes(k));
      if (forbiddenKeys.length > 0) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          `No tienes permiso para modificar: ${forbiddenKeys.join(', ')}. Solo se permite modificar la foto de perfil y el teléfono.`
        );
      }
    }
  }
}

export async function contractsUsersBeforeSave(request) {
  const { object, user, master } = request;
  if (master) return;
  if (!user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Sesión no válida.');
  }

  // Las modificaciones a contracts_Users
  if (!object.isNew()) {
    const isSuperAdmin =
      user.get('isSuperAdmin') === true ||
      (user.get('email') || '').toLowerCase().trim() === 'admin@brascuba.cu';

    if (!isSuperAdmin) {
      // Si el usuario edita su propio contracts_Users, solo puede modificar Phone
      const dirtyKeys = object.dirtyKeys();
      const isSelf = object.get('UserId')?.id === user.id || object.get('Email') === user.get('email');
      if (!isSelf) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'No tienes permiso para modificar otros usuarios.'
        );
      }
      const allowedKeys = ['Phone'];
      const forbiddenKeys = dirtyKeys.filter(k => !allowedKeys.includes(k));
      if (forbiddenKeys.length > 0) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          `No tienes permiso para modificar: ${forbiddenKeys.join(', ')}. Solo el Administrador Principal puede modificar el nombre, cargo o departamento.`
        );
      }
    }
  }
}
