# ETApp Backend API

RESTful API server for ETApp expense tracker, built with Node.js, Express, and Firebase (Firestore + Firebase Auth).

## 🚀 Features

- **Personal Transactions**: CRUD operations for personal expenses
- **Group Management**: Create, join, and leave groups
- **Group Expenses**: Add, edit, delete, and split expenses
- **Balance Calculations**: Real-time debt tracking between users
- **Settlement**: Mark debts as paid
- **Push Notifications**: Real-time updates via Expo Push
- **User Profiles**: Update user information with auto-sync
- **Rate Limiting**: Upstash Redis-based rate limiting
- **Health Monitoring**: Cron job to keep server alive

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: Firestore (via Firebase Admin SDK)
- **Auth**: Firebase Auth (ID tokens verified server-side)
- **Rate Limiting**: Upstash Redis
- **Cron Jobs**: node-cron
- **Environment**: dotenv

## 📦 Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run dev

# Start production server
npm start
```

## 🔐 Environment Variables

Create a `.env` file in the `backend/` directory (or set these variables in your hosting provider):

```env
# Firebase Admin
# Recommended (hosting-friendly): split the service account into separate env vars.
FIREBASE_PROJECT_ID=etapp-607b7
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@etapp-607b7.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n

# Alternatives:
# - One-line JSON
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
# - Base64 JSON
# FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...

# Optional (mostly for GCP): use Application Default Credentials (ADC)
# FIREBASE_USE_ADC=true

# Alternative: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path.
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Optional (NOT recommended for hosting): allow reading a local serviceAccount.json file.
# FIREBASE_ALLOW_CREDENTIAL_FILE=true
# FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json

# Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# Server Configuration
PORT=5001
NODE_ENV=development

# Cron Job (Production only)
API_URL=https://your-api-url.com/api/health
```

Tip: You can copy [backend/.env.example](backend/.env.example) to `backend/.env`.

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── firebase.js         # Firebase Admin init (Firestore/Auth)
│   │   ├── upstash.js         # Redis client setup
│   │   └── cron.js            # Keep-alive cron job
│   │
│   ├── controllers/
│   │   ├── groupsController.js        # Group & expense logic
│   │   ├── transactionsController.js  # Personal transactions
│   │   ├── notificationsController.js # Push tokens
│   │   └── usersController.js         # User profile updates
│   │
│   ├── middleware/
│   │   └── rateLimiter.js     # Upstash rate limiting
│   │
│   ├── routes/
│   │   ├── groupsRoute.js
│   │   ├── transactionsRoute.js
│   │   ├── notificationsRoute.js
│   │   └── usersRoute.js
│   │
│   ├── utils/
│   │   └── pushNotifications.js  # Expo Push API
│   │
│   └── server.js              # Express app entry point
│
├── .env                       # Environment variables (gitignored)
├── .gitignore
├── package.json
└── README.md
```

## 🗄️ Firestore Data Model (High Level)

This backend uses Firestore collections/subcollections instead of SQL tables.

- `users/{uid}`: user profile fields (e.g. `user_name`)
  - `users/{uid}/groups/{groupId}`: membership index
  - `users/{uid}/transactions/{transactionId}`: personal transactions
- `groups/{groupId}`: group metadata (e.g. `name`, `code`, `smart_split_enabled`)
  - `groups/{groupId}/members/{uid}`: group members
  - `groups/{groupId}/expenses/{expenseId}`: group expenses
  - `groups/{groupId}/splits/{splitId}`: expense splits (settlement state)
- `groupCodes/{code}`: maps a join code to `group_id`
- `userTokens/{uid}`: Expo push token per user

## 📡 API Endpoints

### Health Check
```
GET /api/health
```
Returns server status

### Transactions (Personal)

#### Get User Transactions
```
GET /api/transactions/:userId
```

#### Get Summary
```
GET /api/transactions/summary/:userId
```
Returns balance, income, expenses

#### Create Transaction
```
POST /api/transactions
Body: { user_id, title, amount, category }
```

#### Delete Transaction
```
DELETE /api/transactions/:id
```

#### Delete All User Transactions
```
DELETE /api/transactions/user/:userId
```

### Groups

#### Create Group
```
POST /api/groups
Body: { name, userId, userName, currency }
```
Returns group with unique 6-character code

#### Join Group
```
POST /api/groups/join
Body: { code, userId, userName }
```

#### Leave Group
```
POST /api/groups/leave
Body: { groupId, userId }
```
Validates no unsettled debts

#### Get User's Groups
```
GET /api/groups/user/:userId
```

#### Get Group Details
```
GET /api/groups/:groupId
```

#### Get Group Members
```
GET /api/groups/:groupId/members
```

### Expenses

#### Add Expense
```
POST /api/groups/:groupId/expenses
Body: {
  groupId,
  description,
  amount,
  paidBy,      # Can be any member (not just current user)
  category,
  splits: [{ userId, amount }]
}
```

#### Update Expense
```
PUT /api/groups/expenses/:expenseId
Body: { description, amount, category, splits }
```

#### Delete Expense
```
DELETE /api/groups/expenses/:expenseId
Body: { userId }  # Authorization check
```

#### Get Group Expenses
```
GET /api/groups/:groupId/expenses
```

#### Get Expense Splits
```
GET /api/groups/expenses/:expenseId/splits
```

### Balance & Settlement

#### Get User Balance in Group
```
GET /api/groups/:groupId/balance/:userId
```
Returns:
- Total paid by user
- Total owed by user
- Net balance
- Detailed breakdown (who owes whom)

#### Settle Up
```
POST /api/groups/settle
Body: { groupId, fromUserId, toUserId }
```
Marks all debts between two users as settled

### Notifications

#### Register Push Token
```
POST /api/notifications/register
Body: { userId, pushToken }
```

#### Unregister Push Token
```
POST /api/notifications/unregister
Body: { userId }
```

### User Profile

#### Update User Name
```
PUT /api/users/profile
Body: { userId, userName }
```
Updates name across all groups and expenses

#### Get User Profile
```
GET /api/users/profile/:userId
```

## 🔔 Push Notifications

The API sends push notifications for:

- **New Member Joined**: When someone joins a group
- **Expense Added**: When a new expense is added
- **Expense Updated**: When an expense is edited
- **Expense Deleted**: When an expense is removed
- **Member Left**: When someone leaves a group
- **Settlement**: When debts are settled

### Notification Function
```javascript
import { notifyGroupMembers, notifyUser } from "./utils/pushNotifications.js";

// Notify all group members except excludeUserId
await notifyGroupMembers(
  sql,
  groupId,
  excludeUserId,
  "Title",
  "Message body",
  { type: 'event_type', data: {...} }
);

// Notify specific user
await notifyUser(
  sql,
  userId,
  "Title",
  "Message body",
  { type: 'event_type', data: {...} }
);
```

## 🛡️ Security Features

### Rate Limiting
- **Upstash Redis**: Distributed rate limiting
- **Middleware**: `backend/src/middleware/rateLimiter.js`
- **Configuration**: Adjustable limits per endpoint

### Firestore Access
- Firestore is accessed via the Firebase Admin SDK (server-side)
- Authentication is enforced by verifying Firebase Auth ID tokens

### Authorization
- User can only modify their own data
- Expense deletion restricted to payer
- Group operations validated against membership

### Environment Protection
- Sensitive data in `.env` (gitignored)
- No hardcoded credentials
- Production-ready configuration

## 🔄 Cron Jobs

### Keep-Alive Ping (Production Only)
```javascript
// Runs every 14 minutes to prevent cold starts
cron.schedule("*/14 * * * *", async () => {
  await fetch(process.env.API_URL);
});
```

Activated when `NODE_ENV=production`

## 🧪 Testing

### Manual Testing with cURL

#### Create Group
```bash
curl -X POST http://localhost:5001/api/groups \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekend Trip",
    "userId": "user_123",
    "userName": "John Doe"
  }'
```

#### Add Expense
```bash
curl -X POST http://localhost:5001/api/groups/1/expenses \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 1,
    "description": "Dinner",
    "amount": 150.00,
    "paidBy": "user_123",
    "category": "food",
    "splits": [
      { "userId": "user_123", "amount": 50 },
      { "userId": "user_456", "amount": 50 },
      { "userId": "user_789", "amount": 50 }
    ]
  }'
```

#### Get Balance
```bash
curl http://localhost:5001/api/groups/1/balance/user_123
```

## 🚀 Deployment

### Recommended Platforms
- **Render**: Easy setup, free tier available
- **Railway**: Simple deployment
- **Heroku**: Classic PaaS option
- **Vercel/Netlify**: Serverless functions

### Deployment Steps (Render)

1. **Create Web Service**
   - Connect GitHub repository
   - Root directory: `backend`
   - Build command: `npm install`
   - Start command: `npm start`

2. **Environment Variables**
   - Add all variables from `.env`
   - Set `NODE_ENV=production`

3. **Firebase**
  - Create a Firebase project with Firestore enabled
  - Create a service account and set `FIREBASE_SERVICE_ACCOUNT_JSON` on the host

4. **Redis**
   - Create Upstash Redis database
   - Add REST URL and token

5. **Deploy**
   - Trigger deployment
   - Check logs for any issues

### Post-Deployment

1. Test health endpoint: `https://your-api.com/api/health`
2. Update mobile app API URL
3. Test all endpoints
4. Monitor logs for errors

## 📊 Monitoring

### Health Check
```bash
curl https://your-api.com/api/health
```

### Logs
```bash
# View logs on Render
render logs

# View logs on Railway  
railway logs
```

### Firestore Monitoring
- Firebase Console (Firestore usage, indexes, latency)

## 🐛 Troubleshooting

### Database Connection Issues
- Ensure `FIREBASE_SERVICE_ACCOUNT_JSON` is set (or `GOOGLE_APPLICATION_CREDENTIALS` on the host)
- Check backend logs for Firebase Admin initialization errors

### Rate Limiting Not Working
- Verify Upstash credentials
- Check Redis dashboard
- Test with multiple requests

### Cron Job Not Running
- Ensure `NODE_ENV=production`
- Check `API_URL` is set correctly
- View logs for cron execution

### Push Notifications Failing
- Verify Expo Push tokens are valid
- Check Expo Push API status
- Validate notification payload

## 🔧 Development Tips

### Hot Reload
```bash
npm run dev  # Uses nodemon for auto-restart
```

### Data Model Changes
- Update Firestore document shapes in controllers
- Add Firestore composite indexes if a query requires it (Firebase Console will suggest indexes)

### Debug Mode
```javascript
// Add console logs
console.log("Debug:", variable);

// Or use debug package
const debug = require('debug')('api:controller');
debug('Processing request');
```

## 📈 Performance Optimization

- **Firestore Queries**: Prefer indexed queries and keep reads bounded
- **Rate Limiting**: Prevents abuse
- **Indexes**: Add composite indexes when Firestore requires them
- **Caching**: Consider Redis caching for hot data

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details

---

Built with ❤️ using Node.js and Express
