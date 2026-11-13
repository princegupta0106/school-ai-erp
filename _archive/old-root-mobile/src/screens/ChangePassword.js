import React, { useState } from 'react';
import { api } from '../api';
import { Sheet, Field, Input, Btn, ErrorBox, useRun } from '../ui';

export default function ChangePassword({ onClose }) {
  const [f, setF] = useState({ current_password: '', new_password: '' });
  const { err, busy, run } = useRun();
  return (
    <Sheet title="Change password" onClose={onClose}>
      <Field req label="Current password"><Input secureTextEntry value={f.current_password} onChangeText={(v) => setF({ ...f, current_password: v })} /></Field>
      <Field req label="New password"><Input secureTextEntry value={f.new_password} onChangeText={(v) => setF({ ...f, new_password: v })} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title="Update password" disabled={busy || !f.current_password || !f.new_password} onPress={run(async () => { await api.post('/auth/change-password', f); onClose(); }, 'Password changed')} />
    </Sheet>
  );
}
