const notifier = require('node-notifier');
const path = require('path');

class Notifier {
  notify(caseItem, newStatus, oldStatus) {
    const title = `USCIS Status Changed!`;
    const message = [
      `${caseItem.receiptNumber}${caseItem.label ? ' — ' + caseItem.label : ''}`,
      ``,
      `Old: ${oldStatus || 'N/A'}`,
      `New: ${newStatus}`,
    ].join('\n');

    try {
      notifier.notify({
        title,
        message,
        sound: true,
        wait: true,
        appID: 'USCIS Tracker',
      });
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  }

  notifyError(message) {
    try {
      notifier.notify({
        title: 'USCIS Tracker — Error',
        message,
        sound: false,
        appID: 'USCIS Tracker',
      });
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  }

  notifyInfo(message) {
    try {
      notifier.notify({
        title: 'USCIS Tracker',
        message,
        sound: false,
        appID: 'USCIS Tracker',
      });
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  }
}

module.exports = { Notifier };
