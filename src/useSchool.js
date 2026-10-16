import React, { useState } from 'react';
import { View } from 'react-native';
import { useApi } from './useApi';
import { Choice } from './ui';

// Super admin picks a school; everyone else is fixed to their own.
export function useSchoolId(me) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useApi(sup ? '/schools' : null);
  const [pick, setPick] = useState('');
  const sid = sup ? (pick || schools?.[0]?.id || '') : me.school_id;
  const picker = sup && schools?.length > 1 ? <View style={{ marginBottom: 12 }}><Choice value={sid} onChange={setPick} options={schools.map((x) => ({ value: x.id, label: x.name }))} /></View> : null;
  return { sid, picker, qs: sup ? `school_id=${sid}` : '' };
}
