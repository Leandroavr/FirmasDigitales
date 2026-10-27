/**
 * Script de limpieza del sistema para puesta en producción con LDAP
 * 
 * Uso:
 *   node clean-system.js --all
 *   node clean-system.js --keep-admin <admin_email>
 */

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo-container:27017/OpenSignDB';

async function main() {
  const args = process.argv.slice(2);
  const keepAdminIndex = args.indexOf('--keep-admin');
  const keepAdminEmail = keepAdminIndex !== -1 ? (args[keepAdminIndex + 1] || '').trim().toLowerCase() : null;

  console.log('\n=============================================');
  console.log('   LIMPIEZA DE DOCUMENTOS Y USUARIOS');
  console.log('=============================================');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  // 1. Limpiar documentos
  const docResult = await db.collection('contracts_Document').deleteMany({});
  console.log(`- Documentos eliminados (contracts_Document): ${docResult.deletedCount}`);

  // 2. Limpiar carpetas
  const folderResult = await db.collection('contracts_Folder').deleteMany({});
  console.log(`- Carpetas eliminadas (contracts_Folder): ${folderResult.deletedCount}`);

  // 3. Limpiar libreta de contactos
  const contactResult = await db.collection('contracts_Contactbook').deleteMany({});
  console.log(`- Contactos eliminados (contracts_Contactbook): ${contactResult.deletedCount}`);

  // 4. Limpiar sesiones activas
  const sessionResult = await db.collection('_Session').deleteMany({});
  console.log(`- Sesiones eliminadas (_Session): ${sessionResult.deletedCount}`);

  // 5. Limpiar usuarios
  let userQuery = {};
  let extUserQuery = {};

  if (keepAdminEmail) {
    userQuery = { email: { $ne: keepAdminEmail }, username: { $ne: keepAdminEmail } };
    extUserQuery = { Email: { $ne: keepAdminEmail } };
    console.log(`- Conservando cuenta Superadmin: ${keepAdminEmail}`);
  }

  const userResult = await db.collection('_User').deleteMany(userQuery);
  console.log(`- Usuarios eliminados (_User): ${userResult.deletedCount}`);

  const extUserResult = await db.collection('contracts_Users').deleteMany(extUserQuery);
  console.log(`- Perfiles eliminados (contracts_Users): ${extUserResult.deletedCount}`);

  // 6. Limpiar archivos físicos PDF del disco
  const uploadDir = path.resolve('files/files');
  if (fs.existsSync(uploadDir)) {
    try {
      const files = fs.readdirSync(uploadDir);
      let count = 0;
      for (const file of files) {
        const filePath = path.join(uploadDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          count++;
        }
      }
      console.log(`- Archivos físicos eliminados de files/files/: ${count}`);
    } catch (e) {
      console.warn(`- Advertencia al limpiar archivos físicos: ${e.message}`);
    }
  }

  console.log('\n¡Limpieza completada exitosamente!');
  console.log('La base de datos está lista para operar con Active Directory / LDAP.');
  console.log('=============================================\n');

  await client.close();
}

main().catch((err) => {
  console.error('Error durante la limpieza:', err);
  process.exit(1);
});
