import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { api, setToken, API_URL } from '../api';
import { C } from '../theme';
import { Card, Field, Input, Btn, ErrorBox, Dim } from '../ui';

export default function Login({ onDone }) {
  const [f, setF] = useState({ login_id: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(''); setBusy(true);
    try { const r = await api.post('/auth/login', f); await setToken(r.token); onDone(r.me); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: C.bg }}>
      <Card style={{ padding: 20 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: C.brand, marginBottom: 4 }}>School Portal</Text>
        <Dim style={{ marginBottom: 16 }}>Sign in with your school ID</Dim>
        <Field label="User ID"><Input autoCapitalize="none" autoCorrect={false} value={f.login_id} onChangeText={(v) => setF({ ...f, login_id: v })} /></Field>
        <Field label="Password"><Input secureTextEntry value={f.password} onChangeText={(v) => setF({ ...f, password: v })} onSubmitEditing={go} /></Field>
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Signing in...' : 'Sign in'} onPress={go} disabled={busy || !f.login_id || !f.password} />
        <Dim style={{ marginTop: 14, fontSize: 11 }}>Server: {API_URL}</Dim>
      </Card>
    </KeyboardAvoidingView>
  );
}
