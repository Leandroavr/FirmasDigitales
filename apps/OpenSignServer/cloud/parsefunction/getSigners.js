// Function to escape special characters in the search string
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const isGeneralAdmin = (email, obj) => {
  const normEmail = (email || '').toLowerCase().trim();
  if (normEmail === 'admin@brascuba.cu') return true;
  if (obj) {
    if (obj.get?.('isSuperAdmin') === true || obj.isSuperAdmin === true) return true;
    const objEmail = (obj.get?.('Email') || obj.get?.('email') || obj.Email || obj.email || '').toLowerCase().trim();
    if (objEmail === 'admin@brascuba.cu') return true;
  }
  return false;
};

function formatDisplayName(raw, email) {
  if (!raw && email) {
    raw = email.split('@')[0];
  }
  if (!raw) return '';
  if (raw.includes('.') && !raw.includes(' ')) {
    return raw
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return raw;
}

export default async function getSigners(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
  }

  const rawSearch = (request.params.search || '').trim();
  const escapedSearch = escapeRegExp(rawSearch);
  const searchRegex = new RegExp(escapedSearch, 'i');

  try {
    // 1. Consultar usuarios corporativos en contracts_Users (excluyendo deshabilitados y Administrador General)
    const userQueryName = new Parse.Query('contracts_Users');
    userQueryName.matches('Name', searchRegex);

    const userQueryEmail = new Parse.Query('contracts_Users');
    userQueryEmail.matches('Email', searchRegex);

    const userQueryJob = new Parse.Query('contracts_Users');
    userQueryJob.matches('JobTitle', searchRegex);

    const userQueryDept = new Parse.Query('contracts_Users');
    userQueryDept.matches('Department', searchRegex);

    const corporateUsersQuery = Parse.Query.or(userQueryName, userQueryEmail, userQueryJob, userQueryDept);
    corporateUsersQuery.notEqualTo('IsDisabled', true);
    corporateUsersQuery.limit(500);
    const rawCorporateUsers = await corporateUsersQuery.find({ useMasterKey: true });
    const corporateUsers = rawCorporateUsers.filter(cu => !isGeneralAdmin(cu.get('Email'), cu));

    const corpUsersByEmail = new Map();
    for (const cu of corporateUsers) {
      const email = cu.get('Email')?.toLowerCase()?.trim();
      if (email && !isGeneralAdmin(email, cu)) {
        corpUsersByEmail.set(email, cu);
      }
    }

    // 2. Consultar contactos en contracts_Contactbook
    const contactNameQuery = new Parse.Query('contracts_Contactbook');
    contactNameQuery.matches('Name', searchRegex);

    const contactEmailQuery = new Parse.Query('contracts_Contactbook');
    contactEmailQuery.matches('Email', searchRegex);

    const contactJobQuery = new Parse.Query('contracts_Contactbook');
    contactJobQuery.matches('JobTitle', searchRegex);

    const contactDeptQuery = new Parse.Query('contracts_Contactbook');
    contactDeptQuery.matches('Department', searchRegex);

    const contactsQuery = Parse.Query.or(contactNameQuery, contactEmailQuery, contactJobQuery, contactDeptQuery);
    contactsQuery.notEqualTo('IsDeleted', true);
    contactsQuery.limit(500);
    const rawContacts = await contactsQuery.find({ useMasterKey: true });
    const contacts = rawContacts.filter(c => !isGeneralAdmin(c.get('Email'), c));

    // Indexar contactos por correo en minúsculas
    const contactsByEmail = new Map();
    for (const c of contacts) {
      const email = c.get('Email')?.toLowerCase()?.trim();
      if (email && !isGeneralAdmin(email, c) && !contactsByEmail.has(email)) {
        contactsByEmail.set(email, c);
      }
    }

    // 3. Para cualquier usuario corporativo no presente en contracts_Contactbook, auto-crear o sincronizar
    for (const cu of corporateUsers) {
      const email = cu.get('Email')?.toLowerCase()?.trim();
      const name = cu.get('Name') || email;
      if (!email || isGeneralAdmin(email, cu)) continue;

      let contact = contactsByEmail.get(email);
      if (!contact) {
        try {
          const newContact = new Parse.Object('contracts_Contactbook');
          newContact.set('Name', name);
          newContact.set('Email', email);
          newContact.set('UserRole', 'contracts_Guest');
          newContact.set('IsDeleted', false);
          if (cu.get('Phone')) newContact.set('Phone', cu.get('Phone'));
          if (cu.get('Company')) newContact.set('Company', cu.get('Company'));
          if (cu.get('JobTitle')) newContact.set('JobTitle', cu.get('JobTitle'));
          if (cu.get('Department')) newContact.set('Department', cu.get('Department'));
          newContact.set('CreatedBy', request.user);
          const savedContact = await newContact.save(null, { useMasterKey: true });
          contactsByEmail.set(email, savedContact);
        } catch (createErr) {
          console.error('Error auto-creando contacto para usuario corporativo:', createErr);
        }
      } else {
        // Asegurar que JobTitle y Department del usuario corporativo se reflejen en el contacto
        const cuJob = cu.get('JobTitle');
        const cuDept = cu.get('Department');
        let needsSave = false;
        if (cuJob && contact.get('JobTitle') !== cuJob) {
          contact.set('JobTitle', cuJob);
          needsSave = true;
        }
        if (cuDept && contact.get('Department') !== cuDept) {
          contact.set('Department', cuDept);
          needsSave = true;
        }
        if (needsSave) {
          contact.save(null, { useMasterKey: true }).catch(e => console.warn('Sync contact err:', e));
        }
      }
    }

    // 4. Formatear y retornar la lista completa deduplicada para el selector
    const result = [];
    const seenEmails = new Set();

    for (const [email, contact] of contactsByEmail.entries()) {
      if (isGeneralAdmin(email, contact)) continue;
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

      const cu = corpUsersByEmail.get(email);
      const rawName = cu?.get('Name') || contact.get('Name') || email;
      const name = formatDisplayName(rawName, email);
      const jobTitle = cu?.get('JobTitle') || contact.get('JobTitle') || '';
      const department = cu?.get('Department') || contact.get('Department') || '';

      const hierarchyLevel = cu?.get('HierarchyLevel') || contact.get('HierarchyLevel') || '';
      const reportsTo = cu?.get('ReportsTo') || contact.get('ReportsTo') || '';

      result.push({
        objectId: contact.id,
        extUserId: cu?.id || contact.id,
        Name: name,
        Email: email,
        JobTitle: jobTitle,
        Department: department,
        HierarchyLevel: hierarchyLevel,
        ReportsTo: reportsTo,
        Phone: contact.get('Phone') || cu?.get('Phone') || '',
        Company: contact.get('Company') || cu?.get('Company') || '',
      });
    }

    // Ordenar alfabéticamente por Nombre
    result.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));

    return result;
  } catch (err) {
    console.error('Err in getSigners:', err);
    throw err;
  }
}
