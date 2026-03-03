"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UICarouselProps } from "./types";

export const A2UICarousel = React.memo(function A2UICarousel({
    id,
    isLight = false,
}: A2UICarouselProps) {
    return (
        <div id={id} className="w-full overflow-hidden">
            <div className={cn(
                "flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 hide-scrollbar",
            )}>
                {/* Carousel structural boundary.
                    Since A2UI flat layout doesn't naturally nest components without 'children' arrays, 
                    this component may act as an indicator that following components should be rendered horizontally.
                    For a pure React component, we might want to adapt A2UIRenderer to pass children into it.
                */}
            </div>
        </div>
    );
});
