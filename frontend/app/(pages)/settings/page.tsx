'use client';

import { useState, useEffect } from 'react';
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@services/firebaseAuth.service";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getTags, addCustomTag, removeCustomTag, updateTag } from "@/services/tag.service";
import { Tag } from "@/models/models";
import ColorPickerModal from "@components/ColorPickerModal";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [tags, setTags] = useState<{ requiredTags: Tag[]; customTags: Tag[] }>({ requiredTags: [], customTags: [] });
  const [newTag, setNewTag] = useState({ name: '', color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0') });
  const [currentTagBeingEdited, setCurrentTagBeingEdited] = useState<Tag | null>(null);
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        router.push('/');
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    async function fetchTags() {
      try {
        if (user?.uid) {
          const tagsData = await getTags(user.uid);
          setTags(tagsData);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    }
    fetchTags();
  }, [user]);

  const handleAddTag = async () => {
    if (newTag.name.trim()) {
      const newTagObj: Tag = {
        id: '',
        userId: user?.uid || '',
        name: newTag.name.trim(),
        color: newTag.color,
        required: false,
      };
      addCustomTag(newTagObj);
      try {
        const tagsData = await getTags(user?.uid || '');
        setTags(tagsData);
      } catch (error) {
        console.error('Error updating tags:', error);
      }
      setNewTag({ name: '', color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0') });
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    try {
      if (user?.uid) {
        await removeCustomTag(user.uid, tagName);
        const tagsData = await getTags(user.uid);
        setTags(tagsData);
      }
    } catch (error) {
      console.error('Error removing tag:', error);
    }
  };

  const openColorPicker = (tag: Tag) => {
    setCurrentTagBeingEdited(tag);
  };

  const handleUpdateColor = async (newColor: string) => {
    if (!currentTagBeingEdited || !user?.uid) return;
    const updatedTag = { ...currentTagBeingEdited, color: newColor };
    try {
      await updateTag(updatedTag);
      const tagsData = await getTags(user.uid);
      setTags(tagsData);
    } catch (error) {
      console.error("Error updating tag color:", error);
    } finally {
      setCurrentTagBeingEdited(null);
    }
  };

  const handleCancelColorUpdate = () => {
    setCurrentTagBeingEdited(null);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link 
          href="/dashboard"
          className="flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <svg 
            className="w-5 h-5 mr-1" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          {t('settings.backToDashboard')}
        </Link>
      </div>
      
      <h1 className="text-2xl font-bold mb-8">{t('settings.title')}</h1>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">{t('settings.manageTags')}</h2>
        
        {/* Required Tags */}
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-4">{t('settings.requiredTags')}</h3>
          <div className="space-y-3">
            {tags.requiredTags.map((tag) => (
              <div
                key={tag.name}
                className="flex items-center p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div
                  className="w-6 h-6 rounded-full mr-3"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-gray-800 dark:text-gray-200">{tag.name}</span>
                {/* <button
                  onClick={() => openColorPicker(tag)}
                  className="ml-4 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
                >
                  Edit Color
                </button> */}
              </div>
            ))}
          </div>
        </div>

        {/* Custom Tags */}
        <div>
          <h3 className="text-lg font-medium mb-4">{t('settings.customTags')}</h3>
          
          {/* Add New Tag Form */}
          <div className="flex gap-4 mb-6">
            <input
              type="text"
              value={newTag.name}
              onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
              placeholder={t('settings.tagNamePlaceholder')}
              className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
            <input
              type="color"
              value={newTag.color}
              onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
              className="w-14 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
            />
            <button
              onClick={handleAddTag}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:hover:bg-gray-400 disabled:dark:bg-gray-600"
              disabled={!newTag.name.trim()}
            >
              {t('settings.addTag')}
            </button>
          </div>

          {/* Custom Tags List */}
          <div className="space-y-3">
            {tags.customTags.map((tag) => (
              <div
                key={tag.name}
                className="flex items-center p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div
                  className="w-6 h-6 rounded-full mr-3"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-gray-800 dark:text-gray-200">{tag.name}</span>
                <button
                  onClick={() => openColorPicker(tag)}
                  className="ml-4 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
                >
                  {t('settings.editColor')}
                </button>
                <button
                  onClick={() => handleRemoveTag(tag.name)}
                  className="ml-auto text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  title={t('settings.deleteTag')}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Render ColorPickerModal when a tag is being edited */}
      {currentTagBeingEdited && (
        <ColorPickerModal
          tagName={currentTagBeingEdited.name}
          initialColor={currentTagBeingEdited.color}
          onOk={handleUpdateColor}
          onCancel={handleCancelColorUpdate}
        />
      )}

    </div>
  );
} 