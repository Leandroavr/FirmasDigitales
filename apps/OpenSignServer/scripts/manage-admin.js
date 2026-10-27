/**
 * Script CLI de administración de usuarios y Superadmin para OpenSign
 * 
 * Uso:
 *   node manage-admin.js set-superadmin <email> <password> [nombre]
 *   node manage-admin.js make-admin <email>
 *   node manage-admin.js make-user <email>
 *   node manage-admin.js list-users
 */

import { MongoClient } from 'mongodb';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo-container:27017/OpenSignDB';

async function main() {
  const [,, command, emailArg, passArg, nameArg] = process.argv;

  if (!command) {
    console.log(`
Uso de manage-admin.js:
  node manage-admin.js set-superadmin <email> <password> [nombre]
  node manage-admin.js make-admin <email>
  node manage-admin.js make-user <email>
  node manage-admin.js list-users
`);
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  const usersCol = db.collection('_User');
  const extUsersCol = db.collection('contracts_Users');
  const tenantCol = db.collection('partners_Tenant');
  const orgCol = db.collection('contracts_Organizations');

  if (command === 'list-users') {
    const list = await extUsersCol.find({}).toArray();
    console.log('\n--- Lista de usuarios en OpenSign ---');
    list.forEach((u, i) => {
      console.log(`${i + 1}. [${u.UserRole || 'contracts_User'}] ${u.Name} (${u.Email}) - ID: ${u._id}`);
    });
    console.log('-------------------------------------\n');
    await client.close();
    return;
  }

  if (command === 'make-admin' || command === 'make-user') {
    if (!emailArg) {
      console.error('Error: Debe especificar el email del usuario.');
      process.exit(1);
    }
    const targetEmail = emailArg.trim().toLowerCase();
    const newRole = command === 'make-admin' ? 'contracts_Admin' : 'contracts_User';

    const result = await extUsersCol.updateOne(
      { Email: targetEmail },
      { $set: { UserRole: newRole, _updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      console.error(`Error: No se encontró ningún usuario con el correo "${targetEmail}".`);
    } else {
      console.log(`Éxito: Rol del usuario "${targetEmail}" actualizado a ${newRole}.`);
    }
    await client.close();
    return;
  }

  if (command === 'set-superadmin') {
    if (!emailArg || !passArg) {
      console.error('Error: Debe especificar email y contraseña. Ejemplo:');
      console.error('  node manage-admin.js set-superadmin admin@brascuba.cu Secreto123 "Administrador Brascuba"');
      process.exit(1);
    }

    const email = emailArg.trim().toLowerCase();
    const password = passArg;
    const name = nameArg || 'Super Administrador';

    // Parse usa bcrypt para contraseñas de Parse.User
    // Importamos bcrypt desde node_modules
    const bcrypt = await import('bcryptjs');
    const salt = await bcrypt.default.genSalt(10);
    const hashedPassword = await bcrypt.default.hash(password, salt);

    let defaultTenant = await tenantCol.findOne({});
    if (!defaultTenant) {
      const tenantId = crypto.randomBytes(5).toString('hex');
      defaultTenant = {
        _id: tenantId,
        TenantName: 'Brascuba',
        EmailAddress: email,
        IsActive: true,
        _created_at: new Date(),
        _updated_at: new Date(),
      };
      await tenantCol.insertOne(defaultTenant);
      console.log('Creado Tenant por defecto: Brascuba');
    }

    let defaultOrg = await orgCol.findOne({});
    if (!defaultOrg) {
      const orgId = crypto.randomBytes(5).toString('hex');
      defaultOrg = {
        _id: orgId,
        Name: 'Brascuba',
        IsActive: true,
        _created_at: new Date(),
        _updated_at: new Date(),
      };
      await orgCol.insertOne(defaultOrg);
      console.log('Creada Organización por defecto: Brascuba');
    }

    // Buscar si existe en _User
    let existingUser = await usersCol.findOne({ $or: [{ email }, { username: email }] });
    let userId;

    if (existingUser) {
      userId = existingUser._id;
      await usersCol.updateOne(
        { _id: userId },
        {
          $set: {
            _hashed_password: hashedPassword,
            password: hashedPassword,
            name: name,
            email: email,
            username: email,
            isSuperAdmin: true,
            isLdap: false,
            _updated_at: new Date(),
          },
        }
      );
      console.log(`Usuario _User existente (${email}) actualizado como Superadmin.`);
    } else {
      userId = crypto.randomBytes(5).toString('hex');
      const newUser = {
        _id: userId,
        username: email,
        email: email,
        name: name,
        _hashed_password: hashedPassword,
        password: hashedPassword,
        isSuperAdmin: true,
        isLdap: false,
        _created_at: new Date(),
        _updated_at: new Date(),
      };
      await usersCol.insertOne(newUser);
      console.log(`Nuevo usuario _User (${email}) creado como Superadmin con ID: ${userId}.`);
    }

    // Actualizar o crear en contracts_Users
    let existingExt = await extUsersCol.findOne({ Email: email });
    if (existingExt) {
      await extUsersCol.updateOne(
        { _id: existingExt._id },
        {
          $set: {
            Name: name,
            UserRole: 'contracts_Admin',
            IsDisabled: false,
            _updated_at: new Date(),
          },
        }
      );
      console.log(`contracts_Users (${email}) actualizado con rol contracts_Admin.`);
    } else {
      const extId = crypto.randomBytes(5).toString('hex');
      const newExt = {
        _id: extId,
        Name: name,
        Email: email,
        UserRole: 'contracts_Admin',
        _p_UserId: `_User$${userId}`,
        UserId: { __type: 'Pointer', className: '_User', objectId: userId },
        _p_TenantId: `partners_Tenant$${defaultTenant._id}`,
        TenantId: { __type: 'Pointer', className: 'partners_Tenant', objectId: defaultTenant._id },
        _p_OrganizationId: `contracts_Organizations$${defaultOrg._id}`,
        OrganizationId: { __type: 'Pointer', className: 'contracts_Organizations', objectId: defaultOrg._id },
        Company: 'Brascuba',
        IsDisabled: false,
        _created_at: new Date(),
        _updated_at: new Date(),
      };
      await extUsersCol.insertOne(newExt);
      console.log(`Nuevo contracts_Users (${email}) creado con rol contracts_Admin.`);
    }

    console.log(`\n¡Superadmin configurado exitosamente!\nEmail: ${email}\nContraseña: [OCULTA]\nRol: contracts_Admin\n`);
    await client.close();
    return;
  }

  console.error(`Comando desconocido: ${command}`);
  await client.close();
  process.exit(1);
}

main().catch((err) => {
  console.error('Error ejecutando manage-admin:', err);
  process.exit(1);
});
