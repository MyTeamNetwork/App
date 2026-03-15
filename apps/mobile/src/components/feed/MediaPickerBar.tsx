import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { ImagePlus, X, AlertCircle } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { PendingImage } from "@/hooks/useMediaUpload";

interface MediaPickerBarProps {
  readonly images: readonly PendingImage[];
  readonly isUploading: boolean;
  readonly onAddPress: () => void;
  readonly onRemove: (localUri: string) => void;
  readonly maxImages: number;
}

const THUMB_SIZE = 72;

export const MediaPickerBar = React.memo(function MediaPickerBar({
  images,
  isUploading,
  onAddPress,
  onRemove,
  maxImages,
}: MediaPickerBarProps) {
  if (images.length === 0 && !isUploading) {
    return (
      <View style={styles.addButtonContainer}>
        <Pressable
          onPress={onAddPress}
          style={styles.addPhotoButton}
          accessibilityLabel="Add photos"
          accessibilityRole="button"
        >
          <ImagePlus size={20} color={NEUTRAL.muted} />
          <Text style={styles.addPhotoText}>Add Photos</Text>
        </Pressable>
      </View>
    );
  }

  const uploadingCount = images.filter((img) => img.status === "uploading").length;
  const doneCount = images.filter((img) => img.status === "done").length;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {images.map((image) => (
          <View key={image.localUri} style={styles.thumbWrapper}>
            <Image
              source={{ uri: image.localUri }}
              style={styles.thumb}
              contentFit="cover"
              recyclingKey={image.localUri}
              transition={150}
            />

            {/* Upload overlay */}
            {image.status === "uploading" && (
              <View style={styles.overlay}>
                <ActivityIndicator size="small" color={NEUTRAL.surface} />
              </View>
            )}

            {/* Error overlay */}
            {image.status === "error" && (
              <View style={[styles.overlay, styles.errorOverlay]}>
                <AlertCircle size={18} color={NEUTRAL.surface} />
              </View>
            )}

            {/* Done checkmark */}
            {image.status === "done" && (
              <View style={[styles.overlay, styles.doneOverlay]}>
                <Text style={styles.checkmark}>✓</Text>
              </View>
            )}

            {/* Remove button (disabled during upload) */}
            {!isUploading && (
              <Pressable
                onPress={() => onRemove(image.localUri)}
                style={styles.removeButton}
                accessibilityLabel="Remove image"
                accessibilityRole="button"
                hitSlop={8}
              >
                <X size={12} color={NEUTRAL.surface} />
              </Pressable>
            )}
          </View>
        ))}

        {/* Add more button */}
        {images.length < maxImages && !isUploading && (
          <Pressable
            onPress={onAddPress}
            style={styles.addMoreButton}
            accessibilityLabel="Add more photos"
            accessibilityRole="button"
          >
            <ImagePlus size={24} color={NEUTRAL.muted} />
          </Pressable>
        )}
      </ScrollView>

      {/* Upload progress text */}
      {isUploading && uploadingCount > 0 && (
        <Text style={styles.progressText}>
          Uploading {doneCount + 1}/{images.length}...
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: NEUTRAL.border,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
    alignItems: "center",
  },
  thumbWrapper: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: RADIUS.sm,
    overflow: "hidden",
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorOverlay: {
    backgroundColor: "rgba(220, 38, 38, 0.5)",
  },
  doneOverlay: {
    backgroundColor: "rgba(5, 150, 105, 0.5)",
  },
  checkmark: {
    color: NEUTRAL.surface,
    fontSize: 20,
    fontWeight: "700",
  },
  removeButton: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  addMoreButton: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    borderColor: NEUTRAL.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: NEUTRAL.border,
  },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
  },
  addPhotoText: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.muted,
  },
  progressText: {
    ...TYPOGRAPHY.caption,
    color: SEMANTIC.info,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
  },
});
