# ComfyUI nodes for anim-studio, copied into ComfyUI/custom_nodes by `pnpm setup:painter --video`.
import torch
import comfy.latent_formats
import comfy.model_management
import comfy.utils


class Wan22LoopLatent:
    """
    Wan22ImageToVideoLatent, but the start image is also pinned as the last latent frame, so the model must bring
    the motion back to where it started: the clip loops forward with no jump (its last frame repeats the first).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "vae": ("VAE",),
            "width": ("INT", {"default": 1280, "min": 32, "max": 8192, "step": 32}),
            "height": ("INT", {"default": 704, "min": 32, "max": 8192, "step": 32}),
            "length": ("INT", {"default": 121, "min": 5, "max": 8192, "step": 4}),
            "start_image": ("IMAGE",),
        }}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "execute"
    CATEGORY = "anim-studio"

    def execute(self, vae, width, height, length, start_image):
        t = ((length - 1) // 4) + 1
        dev = comfy.model_management.intermediate_device()
        latent = torch.zeros([1, 48, t, height // 16, width // 16], device=dev)
        mask = torch.ones([1, 1, t, height // 16, width // 16], device=dev)
        img = comfy.utils.common_upscale(start_image[:1].movedim(-1, 1), width, height, "bilinear", "center").movedim(1, -1)
        # the first latent frame holds 1 video frame, every later one 4: the end needs the 4-frame latent of a still
        # image, from encoding it as a 5-frame still clip (a 1-frame latent there decodes as a bright flash)
        still = vae.encode(img.repeat(5, 1, 1, 1))
        latent[:, :, :1] = still[:, :, :1]
        latent[:, :, -1:] = still[:, :, 1:2]
        mask[:, :, :1] = 0.0
        mask[:, :, -1:] = 0.0
        latent = comfy.latent_formats.Wan22().process_out(latent) * mask + latent * (1.0 - mask)
        return ({"samples": latent, "noise_mask": mask},)


class MatchColors:
    """
    Gives every frame the reference image's per-channel mean and spread. The video model dims and tints a clip as it
    goes (~14% darker mid-clip), which a loop shows as a pulse at its seam and a painting shows as a mismatch.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "reference": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "execute"
    CATEGORY = "anim-studio"

    def execute(self, images, reference):
        ref = comfy.utils.common_upscale(reference[:1].movedim(-1, 1), images.shape[2], images.shape[1], "bilinear", "center").movedim(1, -1)
        rm, rs = ref.mean(dim=(1, 2), keepdim=True), ref.std(dim=(1, 2), keepdim=True)
        out = []
        for i in range(0, images.shape[0], 16):  # in chunks: a whole clip at once doubles its memory
            f = images[i:i + 16]
            m, s = f.mean(dim=(1, 2), keepdim=True), f.std(dim=(1, 2), keepdim=True)
            out.append(((f - m) / s.clamp(min=1e-4) * rs + rm).clamp(0, 1))
        return (torch.cat(out),)


NODE_CLASS_MAPPINGS = {"Wan22LoopLatent": Wan22LoopLatent, "AnimStudioMatchColors": MatchColors}
NODE_DISPLAY_NAME_MAPPINGS = {"Wan22LoopLatent": "Wan 2.2 Loop Latent (anim-studio)", "AnimStudioMatchColors": "Match Colors (anim-studio)"}
