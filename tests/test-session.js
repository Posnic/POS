const { MongoClient } = require('mongodb');

async function createTestSession() {
  try {
    console.log('🔍 Creating test session...');
    
    // Connect to MongoDB
    const client = new MongoClient('mongodb://localhost:27017/PosnicPro');
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('PosnicPro');
    const userSessionsCollection = db.collection('user_sessions');
    
    // Check existing sessions
    const existingSessions = await userSessionsCollection.find({}).toArray();
    console.log('🔍 Existing sessions:', existingSessions.length);
    
    // Create a test session (replace with actual user ID)
    const testSession = {
      user_id: '507f1f77bcf86cd799439011', // Replace with actual user ID
      login_time: new Date('2026-04-29T09:00:00.000Z'),
      logout_time: null,
      is_active: true,
      created_at: new Date(),
      session_id: 'test_session_' + Date.now()
    };
    
    // Insert test session
    const result = await userSessionsCollection.insertOne(testSession);
    console.log('✅ Test session created:', result.insertedId);
    
    // Verify session was created
    const createdSession = await userSessionsCollection.findOne({ _id: result.insertedId });
    console.log('🔍 Created session:', createdSession);
    
    await client.close();
    console.log('✅ Connection closed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createTestSession();
