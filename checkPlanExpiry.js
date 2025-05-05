const { Client, Databases, Query } = require('node-appwrite');

// Environment variables set in Appwrite Function settings
const DATABASE_ID = '67fecfed002f909fc072';
const USER_PROFILES_COLLECTION_ID = '67fecffb00075d13ade6';
const FREE_TIER_CHAR_LIMIT = 1000; // Free tier: 1000 characters

module.exports = async function (req, res) {
  // Initialize Appwrite client
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  try {
    // Get current UTC date for comparison
    const currentDate = new Date().toISOString();
    console.log(`Checking for expired subscriptions on ${currentDate}`);

    // Query users with active subscriptions
    let offset = 0;
    const limit = 100; // Process 100 users at a time to avoid timeout
    let hasMore = true;

    while (hasMore) {
      const response = await databases.listDocuments(
        DATABASE_ID,
        USER_PROFILES_COLLECTION_ID,
        [
          Query.equal('is_active', true),
          Query.limit(limit),
          Query.offset(offset),
          Query.orderAsc('$id'),
        ]
      );

      const users = response.documents;
      console.log(`Fetched ${users.length} active users at offset ${offset}`);

      if (users.length === 0) {
        hasMore = false;
        break;
      }

      // Process each user
      for (const user of users) {
        const expiryDate = user.current_plan_expiry_date;
        if (!expiryDate) {
          console.warn(`User ${user.userId} has no expiry date but is_active=true`);
          continue;
        }

        // Compare expiry date with current date (UTC)
        if (new Date(expiryDate) <= new Date(currentDate)) {
          console.log(`Subscription expired for user ${user.userId} (expiry: ${expiryDate})`);

          // Update user profile to inactive free-tier state
          try {
            await databases.updateDocument(
              DATABASE_ID,
              USER_PROFILES_COLLECTION_ID,
              user.$id,
              {
                is_active: false,
                plan_type: 'Free',
                active_product_id: '',
                billing_cycle: '',
                char_allowed: FREE_TIER_CHAR_LIMIT,
                char_remaining: Math.min(user.char_remaining, FREE_TIER_CHAR_LIMIT),
                current_plan_expiry_date: null,
              }
            );
            console.log(`Updated user ${user.userId} to inactive free-tier state`);
          } catch (updateError) {
            console.error(`Failed to update user ${user.userId}:`, updateError.message);
          }
        }
      }

      // Update offset for pagination
      offset += limit;
      hasMore = users.length === limit;
    }

    // Return success response
    res.json({
      status: 'success',
      message: 'Plan expiry check completed',
      timestamp: currentDate,
    });
  } catch (error) {
    console.error('Error during plan expiry check:', error.message, error.stack);
    res.json({
      status: 'error',
      message: 'Failed to check plan expiries',
      error: error.message,
    }, 500);
  }
};