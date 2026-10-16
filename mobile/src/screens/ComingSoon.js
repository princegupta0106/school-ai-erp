import React from 'react';
import { View, Text } from 'react-native';
import { C } from '../theme';
import { Icon } from '../icons';

export default function ComingSoon({ title }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="sparkle" color={C.accent} size={26} /></View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink, marginBottom: 6 }}>{title || 'This screen'} is coming soon</Text>
      <Text style={{ color: C.mute, textAlign: 'center' }}>We're building the mobile app one module at a time. Use the web app for this one for now.</Text>
    </View>
  );
}
