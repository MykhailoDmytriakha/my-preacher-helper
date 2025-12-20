"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Church } from "@/models/models";
import { useUserChurches } from "@/hooks/useUserChurches";
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Transition, ComboboxButton } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";

interface ChurchAutocompleteProps {
    initialValue?: Church;
    onChange: (church: Church) => void;
}

export default function ChurchAutocomplete({
    initialValue,
    onChange
}: ChurchAutocompleteProps) {
    const { t } = useTranslation();
    const { availableChurches } = useUserChurches();
    const [name, setName] = useState(initialValue?.name || "");
    const [city, setCity] = useState(initialValue?.city || "");
    const [query, setQuery] = useState("");

    const filteredChurches = useMemo(() => {
        if (query === "") return availableChurches;
        return availableChurches.filter((church) => {
            return church.name.toLowerCase().includes(query.toLowerCase());
        });
    }, [query, availableChurches]);

    const handleChurchSelect = (church: Church | null) => {
        if (!church) return;
        setName(church.name);
        setCity(church.city || "");
        onChange(church);
    };

    const handleNameChange = (newName: string) => {
        setName(newName);
        setQuery(newName);
        onChange({ id: initialValue?.id || "", name: newName, city });
    };

    const handleCityChange = (newCity: string) => {
        setCity(newCity);
        onChange({ id: initialValue?.id || "", name, city: newCity });
    };

    return (
        <div className="space-y-4">
            <div className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('calendar.church')}
                </label>
                <Combobox
                    value={availableChurches.find(c => c.name === name && c.city === city) || { id: '', name, city }}
                    onChange={handleChurchSelect}
                    by={(a, b) => a?.name === b?.name && a?.city === b?.city}
                >
                    <div className="relative mt-1">
                        <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-white dark:bg-gray-800 text-left border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-opacity-75 sm:text-sm">
                            <ComboboxInput
                                className="w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 dark:text-gray-100 dark:bg-gray-800 focus:ring-0"
                                onChange={(event) => handleNameChange(event.target.value)}
                                displayValue={(church: Church) => church?.name || name}
                                placeholder={t('calendar.churchAutocomplete.placeholder')}
                                required
                            />
                            <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronUpDownIcon
                                    className="h-5 w-5 text-gray-400"
                                    aria-hidden="true"
                                />
                            </ComboboxButton>
                        </div>
                        <Transition
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                            afterLeave={() => setQuery("")}
                        >
                            <ComboboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white dark:bg-gray-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm border dark:border-gray-700">
                                {filteredChurches.length === 0 && query !== "" ? (
                                    <div className="relative cursor-default select-none py-2 px-4 text-gray-700 dark:text-gray-300">
                                        Nothing found.
                                    </div>
                                ) : (
                                    filteredChurches.map((church) => (
                                        <ComboboxOption
                                            key={`${church.name}-${church.city || 'no-city'}`}
                                            className={({ active }) =>
                                                `relative cursor-default select-none py-2 pl-10 pr-4 ${active ? "bg-blue-600 text-white" : "text-gray-900 dark:text-gray-100"
                                                }`
                                            }
                                            value={church}
                                        >
                                            {({ selected, active }) => (
                                                <>
                                                    <span className={`block truncate ${selected ? "font-medium" : "font-normal"}`}>
                                                        {church.name} {church.city && <span className={`text-xs ${active ? 'text-blue-100' : 'text-gray-500'}`}>({church.city})</span>}
                                                    </span>
                                                    {selected ? (
                                                        <span className={`absolute inset-y-0 left-0 flex items-center pl-3 ${active ? "text-white" : "text-blue-600"}`}>
                                                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                                        </span>
                                                    ) : null}
                                                </>
                                            )}
                                        </ComboboxOption>
                                    ))
                                )}
                            </ComboboxOptions>
                        </Transition>
                    </div>
                </Combobox>
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 italic">
                    {availableChurches.length > 0
                        ? `${availableChurches.length} churches in history`
                        : "No history found"}
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('calendar.city')}
                </label>
                <input
                    type="text"
                    value={city}
                    onChange={(e) => handleCityChange(e.target.value)}
                    placeholder={t('calendar.churchAutocomplete.cityPlaceholder')}
                    className="w-full px-3 py-2 border rounded-lg border-gray-200 dark:border-gray-700 dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
            </div>
        </div>
    );
}
