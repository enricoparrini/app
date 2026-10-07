import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { Alert, Linking, Platform } from "react-native";

export type Attachment = {
  data: string; // base64
  mime: string;
  name: string;
  preview: string | null; // data: URL for images; null for PDFs
};

async function compressImage(uri: string, name?: string): Promise<Attachment> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  const data = manipulated.base64 || "";
  return {
    data,
    mime: "image/jpeg",
    name: name || `foto_${Date.now()}.jpg`,
    preview: `data:image/jpeg;base64,${data}`,
  };
}

function denied(label: string) {
  Alert.alert(
    `${label} non autorizzata`,
    `Abilita l'accesso dalle impostazioni del dispositivo per continuare.`,
    [
      { text: "Annulla", style: "cancel" },
      { text: "Apri impostazioni", onPress: () => Linking.openSettings() },
    ]
  );
}

export async function pickImageFromGallery(): Promise<Attachment | null> {
  if (Platform.OS !== "web") {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) denied("Galleria");
      return null;
    }
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.6,
  });
  if (res.canceled) return null;
  return compressImage(res.assets[0].uri);
}

export async function pickImageFromCamera(): Promise<Attachment | null> {
  if (Platform.OS === "web") {
    Alert.alert("Non disponibile", "La fotocamera non è disponibile in anteprima web.");
    return null;
  }
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    if (!perm.canAskAgain) denied("Fotocamera");
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.6,
  });
  if (res.canceled) return null;
  return compressImage(res.assets[0].uri);
}

export async function pickPdfDocument(): Promise<Attachment | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
  });
  if (res.canceled) return null;
  const file = res.assets[0];
  if (Platform.OS === "web" && (file as any).file) {
    // Web: converti il File in base64
    const f: Blob = (file as any).file;
    const b64: string = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.readAsDataURL(f);
    });
    return {
      data: b64,
      mime: "application/pdf",
      name: file.name || "allegato.pdf",
      preview: null,
    };
  }
  const b64 = await FileSystem.readAsStringAsync(file.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    data: b64,
    mime: "application/pdf",
    name: file.name || "allegato.pdf",
    preview: null,
  };
}
