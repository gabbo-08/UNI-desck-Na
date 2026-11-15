import * as webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('PUSH_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('PUSH_VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('PUSH_VAPID_SUBJECT=mailto:admin@example.it');
