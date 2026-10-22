import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../../Utils.js';
import { setDocumentCount } from '../../utils/CountUtils.js';

async function DocumentBeforesave(request) {
  if (!request.original) {
    const validations = [
      { field: 'Name', max: MAX_NAME_LENGTH },
      { field: 'Note', max: MAX_NOTE_LENGTH },
      { field: 'Description', max: MAX_DESCRIPTION_LENGTH },
    ];

    for (const { field, max } of validations) {
      const value = request?.object?.get(field);
      if (value && value.length > max) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `The "${field}" field must be at most ${max} characters long.`
        );
      }
    }

    const TimeToCompleteDays = request?.object?.get('TimeToCompleteDays') || 15;
    const RemindOnceInEvery = request?.object?.get('RemindOnceInEvery') || 5;
    const AutoReminder = request?.object?.get('AutomaticReminders') || false;
    const reminderCount = TimeToCompleteDays / RemindOnceInEvery;
    if (AutoReminder && reminderCount > 15) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'only 15 reminder allowed');
    }
  }
  try {
    // below code is used to update document when user sent document or self signed
    const document = request.object;
    const oldDocument = request.original;

    // Regla estricta: Solo el Admin General (contracts_Admin) puede archivar/borrar documentos completados
    if (oldDocument && oldDocument.get('IsCompleted') && document.get('IsArchive') && !oldDocument.get('IsArchive')) {
      const user = request.user;
      if (!user && !request.master) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'No autorizado.');
      }
      if (user && !request.master) {
        const extUserQuery = new Parse.Query('contracts_Users');
        extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id });
        const extUser = await extUserQuery.first({ useMasterKey: true });
        if (!extUser || extUser.get('UserRole') !== 'contracts_Admin') {
          throw new Parse.Error(
            Parse.Error.OPERATION_FORBIDDEN,
            'Solo el Administrador General puede eliminar documentos completados.'
          );
        }
      }
    }

    // Check if SignedUrl field has been added (transition from undefined to defined)
    if (oldDocument && !oldDocument?.get('SignedUrl') && document?.get('SignedUrl')) {
      if (oldDocument?.get('ExtUserPtr')?.id) {
        setDocumentCount(oldDocument?.get('ExtUserPtr')?.id);
      }
      if (document?.get('Signers') && document.get('Signers').length > 0) {
        document.set('DocSentAt', new Date());
      }
    }
  } catch (err) {
    console.log('err in document beforesave', err.message);
  }
}
export default DocumentBeforesave;
