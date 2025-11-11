import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

interface UseFocusModeProps {
  searchParams: URLSearchParams | null;
  sermonId: string | null;
}

export const useFocusMode = ({ searchParams, sermonId }: UseFocusModeProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const [focusedColumn, setFocusedColumn] = useState<string | null>(null);
  const buildUrlWithParams = useCallback((params: URLSearchParams) => {
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname]);

  const focusMode = searchParams?.get("mode");
  const focusSection = searchParams?.get("section");

  // Initialize Focus mode from URL parameters
  useEffect(() => {
    if (focusMode === 'focus' && focusSection && ['introduction', 'main', 'conclusion'].includes(focusSection)) {
      setFocusedColumn(focusSection);
    } else if (focusMode !== 'focus') {
      setFocusedColumn(null);
    }
  }, [focusMode, focusSection]);

  // Update URL when sermonId changes to preserve Focus mode
  useEffect(() => {
    if (sermonId && focusedColumn && focusMode === 'focus') {
      const newSearchParams = new URLSearchParams();
      newSearchParams.set('mode', 'focus');
      newSearchParams.set('section', focusedColumn);
      
      const currentUrl = buildUrlWithParams(newSearchParams);
      if (typeof window !== 'undefined' && window.location.href !== currentUrl) {
        router.replace(currentUrl);
      }
    }
  }, [sermonId, focusedColumn, focusMode, buildUrlWithParams, router]);

  const handleToggleFocusMode = useCallback((columnId: string) => {
    if (focusedColumn === columnId) {
      // If the same column is clicked, exit focus mode
      setFocusedColumn(null);
      
      // Update URL to remove focus mode
      const newSearchParams = new URLSearchParams(searchParams?.toString() || '');
      newSearchParams.delete('mode');
      newSearchParams.delete('section');
      newSearchParams.delete('sermonId');
      
      router.push(buildUrlWithParams(newSearchParams));
    } else {
      // Otherwise, enter focus mode for the clicked column
      setFocusedColumn(columnId);
      
      // Update URL to include focus mode and section
      const newSearchParams = new URLSearchParams(searchParams?.toString() || '');
      newSearchParams.set('mode', 'focus');
      newSearchParams.set('section', columnId);
      newSearchParams.delete('sermonId');
      
      router.push(buildUrlWithParams(newSearchParams));
    }
  }, [focusedColumn, searchParams, buildUrlWithParams, router]);

  // Function to get navigation sections for focus mode
  const getNavigationSections = useCallback((currentSection: string) => {
    const sections = ['introduction', 'main', 'conclusion'];
    const currentIndex = sections.indexOf(currentSection);
    
    if (currentIndex === -1) return { previous: null, next: null };
    
    return {
      previous: currentIndex > 0 ? sections[currentIndex - 1] : null,
      next: currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null
    };
  }, []);

  // Function to navigate to a specific section in focus mode
  const navigateToSection = useCallback((sectionId: string) => {
    setFocusedColumn(sectionId);
    
    // Update URL to include focus mode and section
    const newSearchParams = new URLSearchParams();
    newSearchParams.set('mode', 'focus');
    newSearchParams.set('section', sectionId);
    
    router.push(buildUrlWithParams(newSearchParams));
  }, [buildUrlWithParams, router]);

  return {
    focusedColumn,
    setFocusedColumn,
    handleToggleFocusMode,
    getNavigationSections,
    navigateToSection,
  };
};
