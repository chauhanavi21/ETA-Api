import { Expo } from 'expo-server-sdk';
import { initFirebase } from '../config/firebase.js';

// Create a new Expo SDK client
const expo = new Expo();
const { db } = initFirebase();

/**
 * Send push notification to specific users
 * @param {Array} pushTokens - Array of Expo push tokens
 * @param {String} title - Notification title
 * @param {String} body - Notification body
 * @param {Object} data - Additional data to send with notification
 */
export async function sendPushNotification(pushTokens, title, body, data = {}) {
  // Filter out invalid tokens
  const validTokens = pushTokens.filter(token => Expo.isExpoPushToken(token));
  
  if (validTokens.length === 0) {
    console.log('No valid push tokens to send to');
    return;
  }

  // Create messages
  const messages = validTokens.map(pushToken => ({
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'default',
  }));

  // Send notifications in chunks
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  return tickets;
}

/**
 * Send notification to all group members except the sender
 * @param {Object} sql - Database connection
 * @param {Number} groupId - Group ID
 * @param {String} excludeUserId - User ID to exclude (usually the action performer)
 * @param {String} title - Notification title
 * @param {String} body - Notification body
 * @param {Object} data - Additional data
 */
export async function notifyGroupMembers(groupId, excludeUserId, title, body, data = {}) {
  try {
    const membersSnap = await db
      .collection('groups')
      .doc(String(groupId))
      .collection('members')
      .get();

    const userIds = [];
    membersSnap.forEach((doc) => {
      if (doc.id !== String(excludeUserId)) userIds.push(doc.id);
    });

    if (userIds.length === 0) return;

    const tokenSnaps = await db.getAll(
      ...userIds.map((uid) => db.collection('userTokens').doc(String(uid)))
    );

    const pushTokens = tokenSnaps
      .map((s) => (s.exists ? s.data().pushToken : null))
      .filter(Boolean);
    
    if (pushTokens.length > 0) {
      await sendPushNotification(pushTokens, title, body, data);
      console.log(`Sent notification to ${pushTokens.length} group members`);
    }
  } catch (error) {
    console.error('Error notifying group members:', error);
  }
}

/**
 * Send notification to a specific user
 * @param {Object} sql - Database connection
 * @param {String} userId - User ID to send notification to
 * @param {String} title - Notification title
 * @param {String} body - Notification body
 * @param {Object} data - Additional data
 */
export async function notifyUser(userId, title, body, data = {}) {
  try {
    const snap = await db.collection('userTokens').doc(String(userId)).get();
    const token = snap.exists ? snap.data().pushToken : null;
    if (!token) return;

    await sendPushNotification([token], title, body, data);
    console.log(`Sent notification to user ${userId}`);
  } catch (error) {
    console.error('Error notifying user:', error);
  }
}
