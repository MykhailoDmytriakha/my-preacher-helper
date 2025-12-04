import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StudyMaterial, StudyNote } from '@/models/models';
import {
  createStudyMaterial,
  createStudyNote,
  deleteStudyMaterial,
  deleteStudyNote,
  getStudyMaterials,
  getStudyNotes,
  updateStudyMaterial,
  updateStudyNote,
} from '@services/studies.service';
import { auth } from '@services/firebaseAuth.service';

function resolveUid(): string | undefined {
  const currentUser = auth.currentUser;
  if (currentUser?.uid) return currentUser.uid;
  if (typeof window === 'undefined') return undefined;
  try {
    const guestData = window.localStorage.getItem('guestUser');
    if (!guestData) return undefined;
    const parsed = JSON.parse(guestData) as { uid?: string };
    return parsed.uid;
  } catch (error) {
    console.error('useStudyNotes: error parsing guestUser', error);
    return undefined;
  }
}

const notesKey = (uid: string | undefined) => ['study-notes', uid];
const materialsKey = (uid: string | undefined) => ['study-materials', uid];

export function useStudyNotes() {
  const uid = resolveUid();
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: notesKey(uid),
    queryFn: () => (uid ? getStudyNotes(uid) : Promise.resolve([])),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const createNote = useMutation({
    mutationFn: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) => createStudyNote(note),
    onSuccess: (created) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) => [created, ...(old ?? [])]);
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<StudyNote> }) => {
      if (!uid) throw new Error('No user');
      return updateStudyNote(id, { ...updates, userId: uid });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).map((n) => (n.id === updated.id ? updated : n))
      );
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id: string) => {
      if (!uid) throw new Error('No user');
      return deleteStudyNote(id, uid);
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).filter((n) => n.id !== id)
      );
    },
  });

  return {
    uid,
    notes: notesQuery.data ?? [],
    loading: notesQuery.isLoading,
    error: notesQuery.error as Error | null,
    refetch: notesQuery.refetch,
    createNote: createNote.mutateAsync,
    updating: updateNoteMutation.isPending,
    updateNote: updateNoteMutation.mutateAsync,
    deleteNote: deleteNoteMutation.mutateAsync,
  };
}

export function useStudyMaterials() {
  const uid = resolveUid();
  const queryClient = useQueryClient();

  const materialsQuery = useQuery({
    queryKey: materialsKey(uid),
    queryFn: () => (uid ? getStudyMaterials(uid) : Promise.resolve([])),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const createMaterialMutation = useMutation({
    mutationFn: (material: Omit<StudyMaterial, 'id' | 'createdAt' | 'updatedAt'>) => createStudyMaterial(material),
    onSuccess: (created) => {
      queryClient.setQueryData<StudyMaterial[]>(materialsKey(uid), (old = []) => [created, ...(old ?? [])]);
    },
  });

  const updateMaterialMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<StudyMaterial> }) => {
      if (!uid) throw new Error('No user');
      return updateStudyMaterial(id, { ...updates, userId: uid });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StudyMaterial[]>(materialsKey(uid), (old = []) =>
        (old ?? []).map((m) => (m.id === updated.id ? updated : m))
      );
    },
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: (id: string) => {
      if (!uid) throw new Error('No user');
      return deleteStudyMaterial(id, uid);
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<StudyMaterial[]>(materialsKey(uid), (old = []) =>
        (old ?? []).filter((m) => m.id !== id)
      );
    },
  });

  return {
    uid,
    materials: materialsQuery.data ?? [],
    loading: materialsQuery.isLoading,
    error: materialsQuery.error as Error | null,
    refetch: materialsQuery.refetch,
    createMaterial: createMaterialMutation.mutateAsync,
    updateMaterial: updateMaterialMutation.mutateAsync,
    deleteMaterial: deleteMaterialMutation.mutateAsync,
  };
}
