/**
 * Test script for dealer login
 * Run: node test-dealer-login.js
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api/dealer';
const MOBILE = '9305241794';

async function testLogin() {
  console.log('\n🧪 Testing Dealer Login for:', MOBILE);
  console.log('=' . repeat(50));

  try {
    // Step 1: Send OTP
    console.log('\n📱 Step 1: Sending OTP...');
    const otpResponse = await axios.post(`${BASE_URL}/auth/send-otp`, {
      mobile: MOBILE
    });

    console.log('✅ OTP Response:', JSON.stringify(otpResponse.data, null, 2));
    
    if (!otpResponse.data.success) {
      console.error('❌ Failed to send OTP');
      return;
    }

    const otp = otpResponse.data.otp;
    console.log('\n🔐 OTP:', otp);

    if (!otp) {
      console.log('⚠️  OTP not in response (production mode). Check server console for OTP.');
      console.log('Enter OTP manually to continue...');
      return;
    }

    // Step 2: Verify OTP
    console.log('\n✓ Step 2: Verifying OTP...');
    const verifyResponse = await axios.post(`${BASE_URL}/auth/verify-otp`, {
      mobile: MOBILE,
      otp: otp
    });

    console.log('✅ Verify Response:', JSON.stringify(verifyResponse.data, null, 2));

    if (!verifyResponse.data.success) {
      console.error('❌ Failed to verify OTP');
      return;
    }

    const token = verifyResponse.data.token;
    console.log('\n🎫 Token:', token);

    // Step 3: Get profile
    console.log('\n👤 Step 3: Getting profile...');
    const profileResponse = await axios.get(`${BASE_URL}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('✅ Profile Response:', JSON.stringify(profileResponse.data, null, 2));

    console.log('\n' + '='.repeat(50));
    console.log('✅ ALL TESTS PASSED! Login working correctly.');
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('\n' + '='.repeat(50));
    console.log('❌ TEST FAILED');
    console.log('='.repeat(50) + '\n');
  }
}

// Run test
testLogin();
