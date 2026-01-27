import { Expo } from 'expo-server-sdk';

// Create a new Expo SDK client
const expo = new Expo();

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
export async function notifyGroupMembers(sql, groupId, excludeUserId, title, body, data = {}) {
  try {
    // Get push tokens for all group members except the excluded user
    const members = await sql`
      SELECT push_token 
      FROM group_members gm
      INNER JOIN user_tokens ut ON gm.user_id = ut.user_id
      WHERE gm.group_id = ${groupId} 
        AND gm.user_id != ${excludeUserId}
        AND ut.push_token IS NOT NULL
    `;

    const pushTokens = members.map(m => m.push_token).filter(Boolean);
    
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
export async function notifyUser(sql, userId, title, body, data = {}) {
  try {
    const user = await sql`
      SELECT push_token 
      FROM user_tokens 
      WHERE user_id = ${userId} 
        AND push_token IS NOT NULL
    `;

    if (user.length > 0 && user[0].push_token) {
      await sendPushNotification([user[0].push_token], title, body, data);
      console.log(`Sent notification to user ${userId}`);
    }
  } catch (error) {
    console.error('Error notifying user:', error);
  }
}
