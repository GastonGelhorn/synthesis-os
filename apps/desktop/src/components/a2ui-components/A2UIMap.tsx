"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UIMapProps } from "./types";
import { MapPin } from "lucide-react";

export const A2UIMap = React.memo(function A2UIMap({
    id,
    latitude,
    longitude,
    zoom = 12,
    markers = [],
    isLight = false,
}: A2UIMapProps) {
    if (latitude == null || longitude == null) return null;

    // For a real implementation, you'd use react-map-gl, leaflet, or google-maps-react.
    // We render a static map image placeholder or iframe using OSM for demo/simplicity
    // without requiring API keys, assuming latitude/longitude format.

    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.05},${latitude - 0.05},${longitude + 0.05},${latitude + 0.05}&layer=mapnik&marker=${latitude},${longitude}`;

    return (
        <div id={id} className={cn(
            "w-full rounded-xl overflow-hidden border relative bg-slate-100",
            isLight ? "border-slate-800/10" : "border-white/[0.06] brightness-[85%] contrast-[1.1] grayscale-[20%]"
        )}>
            <div className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-mono text-slate-700 shadow-sm border border-slate-200">
                {latitude.toFixed(4)}, {longitude.toFixed(4)} • Zoom {zoom}
            </div>

            <iframe
                width="100%"
                height="240"
                frameBorder="0"
                scrolling="no"
                marginHeight={0}
                marginWidth={0}
                src={src}
                className="pointer-events-none" // Disable pointer events on static view to prevent scrolling hijack
            />

            {/* Custom markers overlay if needed (requires projecting lat/lng to pixels, which iFrame OSM doesn't support easily, 
                 but we demonstrate the property logic conceptually. 
                 A proper Mapbox implementation would map through markers array. */}
            {markers.slice(0, 1).map((m, i) => (
                <div key={i} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <MapPin className="text-red-500 drop-shadow-md pb-6" fill="currentColor" size={32} />
                </div>
            ))}
        </div>
    );
});
