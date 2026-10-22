// Function to escape special characters in the search string
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special characters
}

export default async function getSigners(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
  }

  const rawSearch = (request.params.search || '').trim();
  const escapedSearch = escapeRegExp(rawSearch);
  const searchRegex = new RegExp(escapedSearch, 'i');

  try {
    // 1. Query corporate users from contracts_Users (includes LDAP and registered corporate accounts)
    const userQueryName = new Parse.Query('contracts_Users');
    userQueryName.matches('Name', searchRegex);

    const userQueryEmail = new Parse.Query('contracts_Users');
    userQueryEmail.matches('Email', searchRegex);

    const corporateUsersQuery = Parse.Query.or(userQueryName, userQueryEmail);
    corporateUsersQuery.limit(100);
    const corporateUsers = await corporateUsersQuery.find({ useMasterKey: true });

    // 2. Query contacts from contracts_Contactbook (global corporate directory, not restricted by CreatedBy)
    const contactNameQuery = new Parse.Query('contracts_Contactbook');
    contactNameQuery.matches('Name', searchRegex);

    const contactEmailQuery = new Parse.Query('contracts_Contactbook');
    contactEmailQuery.matches('Email', searchRegex);

    const contactsQuery = Parse.Query.or(contactNameQuery, contactEmailQuery);
    contactsQuery.notEqualTo('IsDeleted', true);
    contactsQuery.limit(100);
    const contacts = await contactsQuery.find({ useMasterKey: true });

    // Index contacts by lowercase Email
    const contactsByEmail = new Map();
    for (const c of contacts) {
      const email = c.get('Email')?.toLowerCase()?.trim();
      if (email && !contactsByEmail.has(email)) {
        contactsByEmail.set(email, c);
      }
    }

    // 3. For any corporate user not yet in contracts_Contactbook, auto-create/link a contact
    for (const cu of corporateUsers) {
      const email = cu.get('Email')?.toLowerCase()?.trim();
      const name = cu.get('Name') || email;
      if (!email) continue;

      if (!contactsByEmail.has(email)) {
        try {
          const newContact = new Parse.Object('contracts_Contactbook');
          newContact.set('Name', name);
          newContact.set('Email', email);
          newContact.set('UserRole', 'contracts_Guest');
          newContact.set('IsDeleted', false);
          if (cu.get('Phone')) newContact.set('Phone', cu.get('Phone'));
          if (cu.get('Company')) newContact.set('Company', cu.get('Company'));
          if (cu.get('JobTitle')) newContact.set('JobTitle', cu.get('JobTitle'));
          newContact.set('CreatedBy', request.user);
          const savedContact = await newContact.save(null, { useMasterKey: true });
          contactsByEmail.set(email, savedContact);
        } catch (createErr) {
          console.error('Error auto-creating contact for corporate user:', createErr);
        }
      }
    }

    // 4. Return deduplicated list formatted for the frontend
    const result = [];
    const seenEmails = new Set();

    for (const [email, contact] of contactsByEmail.entries()) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      result.push({
        objectId: contact.id,
        Name: contact.get('Name') || email,
        Email: contact.get('Email') || email,
        Phone: contact.get('Phone') || '',
        Company: contact.get('Company') || '',
      });
    }

    // Sort alphabetically by Name
    result.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));

    return result;
  } catch (err) {
    console.error('Err in getSigners:', err);
    throw err;
  }
}
