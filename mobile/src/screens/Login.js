import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { api, setToken, API_URL } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Field, Input, Btn, ErrorBox, Dim, KeyboardSafe } from '../ui';

export default function Login({ onDone }) {
  const [f, setF] = useState({ login_id: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(''); setBusy(true);
    try { const r = await api.post('/auth/login', f); await setToken(r.token); onDone(r.me); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <KeyboardSafe style={{ justifyContent: 'center', padding: 20, backgroundColor: C.bg }}>
      <Card style={{ padding: 24, borderRadius: 22 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><Icon name="school" size={24} color="#fff" /></View>
        <Text style={{ fontSize: 26, fontWeight: '700', color: C.ink, letterSpacing: -0.5, marginBottom: 4 }}>School Portal</Text>
        <Dim style={{ marginBottom: 20, fontSize: 14 }}>Sign in with your school ID</Dim>
        <Field label="User ID"><Input autoCapitalize="none" autoCorrect={false} value={f.login_id} onChangeText={(v) => setF({ ...f, login_id: v })} /></Field>
        <Field label="Password"><Input secureTextEntry value={f.password} onChangeText={(v) => setF({ ...f, password: v })} onSubmitEditing={go} /></Field>
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Signing in...' : 'Sign in'} onPress={go} disabled={busy || !f.login_id || !f.password} />
        <Dim style={{ marginTop: 14, fontSize: 11 }}>Server: {API_URL}</Dim>
      </Card>
    </KeyboardSafe>
  );
}
