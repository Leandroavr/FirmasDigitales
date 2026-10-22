export async function isUserAdmin(userEmail, userId) {
  try {
    if (!userEmail && !userId) return false;

    // 1. Check list of admin emails configured in environment variable
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    if (userEmail && adminEmails.includes(userEmail.toLowerCase())) {
      return true;
    }

    // 2. Check contracts_Users role
    const extUserQuery = new Parse.Query('contracts_Users');
    if (userEmail) {
      extUserQuery.equalTo('Email', userEmail);
    } else if (userId) {
      extUserQuery.equalTo('UserId', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId,
      });
    }

    const extUser = await extUserQuery.first({ useMasterKey: true });
    if (extUser) {
      const role = extUser.get('UserRole');
      if (role === 'contracts_Admin' || role === 'contracts_OrgAdmin') {
        return true;
      }
      const extEmail = extUser.get('Email');
      if (extEmail && adminEmails.includes(extEmail.toLowerCase())) {
        return true;
      }
    }

    // 3. Check Parse.Role 'admin'
    if (userId) {
      const roleQuery = new Parse.Query(Parse.Role);
      roleQuery.equalTo('name', 'admin');
      roleQuery.equalTo('users', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId,
      });
      const role = await roleQuery.first({ useMasterKey: true });
      if (role) return true;
    }

    return false;
  } catch (err) {
    console.log('Error verifying admin status in adminHelper:', err);
    return false;
  }
}
